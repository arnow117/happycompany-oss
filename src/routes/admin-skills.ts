import type { Hono } from 'hono';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { join, basename } from 'node:path';
import { scanSkillDirectory, parseFrontmatter, validateSkillId } from '../skills.js';
import type { BotManager } from '../bot.js';
import { getSkillsDir } from '../workdir.js';
import { parse as parseYaml } from 'yaml';

export interface AdminSkillsDeps {
  skillsDir: string;
  botManager: BotManager;
  corpDir: string;
}

interface SkillSourceRoot {
  source: string;
  rootDir: string;
}

function tenantSkillSources(corpDir: string, tenant?: string): SkillSourceRoot[] {
  if (!existsSync(corpDir)) return [];

  const tenantNames = tenant
    ? [tenant]
    : readdirSync(corpDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

  return tenantNames
    .map((tenantName) => ({
      source: `tenant:${tenantName}`,
      rootDir: join(corpDir, tenantName, '.claude', 'skills'),
    }))
    .filter((sourceRoot) => existsSync(sourceRoot.rootDir));
}

function availableSkillSources(deps: AdminSkillsDeps, tenant?: string): SkillSourceRoot[] {
  const homeSkillsDir = join(process.env.HOME || '~', '.claude', 'skills');
  return [
    { source: 'local', rootDir: deps.skillsDir },
    ...tenantSkillSources(deps.corpDir, tenant),
    { source: 'global', rootDir: homeSkillsDir },
  ];
}

function scanAvailableSkills(deps: AdminSkillsDeps, tenant?: string): ReturnType<typeof scanSkillDirectory> {
  const skills = availableSkillSources(deps, tenant)
    .flatMap((sourceRoot) => scanSkillDirectory(sourceRoot.rootDir, sourceRoot.source));

  const localNames = new Set(
    skills.filter((skill) => skill.source === 'local').map((skill) => skill.name),
  );

  return skills.filter((skill) => skill.source !== 'global' || !localNames.has(skill.name));
}

export function registerAdminSkillsRoutes(app: Hono, deps: AdminSkillsDeps): void {
  app.get('/api/admin/skills', (c) => {
    try {
      const tenant = c.req.query('tenant');
      if (tenant && !validateSkillId(tenant)) {
        return c.json({ error: `Invalid tenant: ${tenant}` }, 400);
      }
      return c.json(scanAvailableSkills(deps, tenant));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.get('/api/admin/workdir-skills', (c) => {
    const workdirPath = c.req.query('path');
    if (!workdirPath) return c.json({ error: 'path query parameter is required' }, 400);
    try {
      const skillsRoot = join(workdirPath, '.claude', 'skills');
      if (!existsSync(skillsRoot)) return c.json([]);

      const entries = readdirSync(skillsRoot, { withFileTypes: true });
      const skills = entries
        .filter((e) => e.isDirectory())
        .map((e) => {
          const skillPath = join(skillsRoot, e.name);
          let fileCount = 0;
          let hasSkillMd = false;
          try {
            const files = readdirSync(skillPath);
            fileCount = files.length;
            hasSkillMd = files.includes('SKILL.md');
          } catch { /* unreadable directory */ }
          return { name: e.name, hasSkillMd, fileCount };
        });
      return c.json(skills);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.get('/api/admin/workdir-skills/:name', (c) => {
    const workdirPath = c.req.query('path');
    if (!workdirPath) return c.json({ error: 'path query parameter is required' }, 400);
    const name = c.req.param('name');
    if (!validateSkillId(name)) {
      return c.json({ error: `Invalid skill name: ${name}` }, 400);
    }
    try {
      const skillDir = join(workdirPath, '.claude', 'skills', name);
      const skillMdPath = join(skillDir, 'SKILL.md');

      if (!existsSync(skillMdPath)) {
        return c.json({ name, exists: false });
      }

      const content = readFileSync(skillMdPath, 'utf-8');

      const otherFiles: string[] = [];
      if (existsSync(skillDir)) {
        try {
          otherFiles.push(
            ...readdirSync(skillDir).filter((f) => f !== 'SKILL.md'),
          );
        } catch { /* unreadable */ }
      }

      return c.json({ name, content, exists: true, otherFiles });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.put('/api/admin/workdir-skills/:name', async (c) => {
    const workdirPath = c.req.query('path');
    if (!workdirPath) return c.json({ error: 'path query parameter is required' }, 400);
    const name = c.req.param('name');
    if (!validateSkillId(name)) {
      return c.json({ error: `Invalid skill name: ${name}` }, 400);
    }
    try {
      const body = await c.req.json();
      const { content } = body as { content?: unknown };
      if (typeof content !== 'string' || content.trim().length === 0) {
        return c.json({ error: 'content must be a non-empty string' }, 400);
      }

      const frontmatter = parseFrontmatter(content);
      if (Object.keys(frontmatter).length === 0) {
        return c.json({ error: 'Invalid SKILL.md: missing or empty frontmatter (needs --- delimited YAML header)' }, 400);
      }

      const skillDir = join(workdirPath, '.claude', 'skills', name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
      return c.json({ updated: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // Reverse lookup: which bots have this skill installed in their workdir
  app.get('/api/admin/skills/:name/bots', (c) => {
    const skillName = c.req.param('name');
    if (!validateSkillId(skillName)) {
      return c.json({ error: `Invalid skill name: ${skillName}` }, 400);
    }
    try {
      const botInfos = deps.botManager.getBotInfos();
      const matched = botInfos.filter((bot) => {
        const skillDir = join(bot.workdir, '.claude', 'skills', skillName);
        return existsSync(skillDir);
      });
      return c.json(matched);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // Reverse lookup: which digital employees have this skill declared in their YAML
  app.get('/api/admin/skills/:name/employees', (c) => {
    const skillName = c.req.param('name');
    if (!validateSkillId(skillName)) {
      return c.json({ error: `Invalid skill name: ${skillName}` }, 400);
    }
    try {
      const matched: Array<{ id: string; displayName: string; role: string; tenant: string }> = [];
      if (!existsSync(deps.corpDir)) return c.json(matched);

      for (const tenantEntry of readdirSync(deps.corpDir, { withFileTypes: true })) {
        if (!tenantEntry.isDirectory()) continue;
        const employeesDir = join(deps.corpDir, tenantEntry.name, 'employees');
        if (!existsSync(employeesDir)) continue;
        for (const empFile of readdirSync(employeesDir, { withFileTypes: true })) {
          if (!empFile.isFile() || !empFile.name.endsWith('.yaml')) continue;
          try {
            const raw = parseYaml(readFileSync(join(employeesDir, empFile.name), 'utf-8'));
            if (!raw || typeof raw !== 'object') continue;
            const doc = raw as Record<string, unknown>;
            const skills: unknown[] = Array.isArray(doc.skills) ? doc.skills : [];
            if (skills.includes(skillName)) {
              matched.push({
                id: String(doc.id ?? empFile.name.replace('.yaml', '')),
                displayName: String(doc.displayName ?? doc.id ?? empFile.name),
                role: String(doc.role ?? ''),
                tenant: tenantEntry.name,
              });
            }
          } catch { /* skip malformed YAML */ }
        }
      }
      return c.json(matched);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  // Bind / unbind skills to a bot's workdir
  app.patch('/api/admin/employees/:name/skills', async (c) => {
    const botName = c.req.param('name');
    const body = await c.req.json();
    const { add, remove } = body as { add?: string[]; remove?: string[] };
    if (!add?.length && !remove?.length) {
      return c.json({ error: 'add or remove array is required' }, 400);
    }

    try {
      const botInfo = deps.botManager.getBotInfos().find((b) => b.name === botName);
      if (!botInfo) return c.json({ error: `Bot not found: ${botName}` }, 404);
      const wd = botInfo.workdir;

      const availableSkills = scanAvailableSkills(deps, botInfo.tenant);
      const sourceDirMap = new Map(
        availableSkillSources(deps, botInfo.tenant).map((sourceRoot) => [sourceRoot.source, sourceRoot.rootDir]),
      );

      // Add skills: copy from global source to workdir
      for (const name of (add ?? [])) {
        if (!validateSkillId(name)) continue;
        const skill = availableSkills.find((s) => s.name === name || s.id === name);
        if (!skill) continue;
        const srcRoot = sourceDirMap.get(skill.source);
        if (!srcRoot) continue;
        const srcDir = join(srcRoot, skill.id);
        const dstDir = join(getSkillsDir(wd), name);
        if (!existsSync(srcDir)) continue;
        mkdirSync(dstDir, { recursive: true });
        cpSync(srcDir, dstDir, { recursive: true, force: true });
      }

      // Remove skills: delete from workdir
      for (const name of (remove ?? [])) {
        if (!validateSkillId(name)) continue;
        const skillDir = join(getSkillsDir(wd), name);
        if (existsSync(skillDir)) rmSync(skillDir, { recursive: true, force: true });
      }

      // Return updated skill list
      const skillsRoot = getSkillsDir(wd);
      const entries = existsSync(skillsRoot)
        ? readdirSync(skillsRoot, { withFileTypes: true })
        : [];
      const updated = entries
        .filter((e) => e.isDirectory())
        .map((e) => {
          const sd = join(skillsRoot, e.name);
          let fileCount = 0;
          let hasSkillMd = false;
          try {
            const files = readdirSync(sd);
            fileCount = files.length;
            hasSkillMd = files.includes('SKILL.md');
          } catch { /* unreadable */ }
          return { name: e.name, hasSkillMd, fileCount };
        });

      return c.json(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });
}
