import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

// Inline the route handlers under test so we don't need to spin up the
// full startWebServer (which binds a real TCP port).
//
// We extract the logic into a helper that mirrors what web.ts does,
// and test it via Hono's app.request() — the same pattern as
// web-app-routes.test.ts.
//
// Rather than duplicating handler code, we import from web.ts indirectly
// by re-registering routes on a test Hono instance. However, the routes
// in web.ts are closures over `deps`. So instead we replicate just the
// route registration function for testing.
//
// To keep tests self-contained and avoid refactoring web.ts solely for
// testability, we extract the workdir skill routes into a reusable
// registration function that mirrors the real app structure.

import { parseFrontmatter, validateSkillId } from '../src/skills.js';

// --- Reusable route registration (mirrors web.ts structure) ---

interface WorkdirSkillDeps {
  skillsDir: string;
}

function registerWorkdirSkillRoutes(app: Hono, _deps: WorkdirSkillDeps): void {
  const { join } = path;
  const { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } = fs;

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
            ...readdirSync(skillDir).filter(
              (f) => f !== 'SKILL.md',
            ),
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
}

// --- Test fixtures ---

const VALID_SKILL_MD = `---
name: test-skill
description: A skill for testing
user-invocable: true
---

# Test Skill

This is a test skill body.
`;

const SKILL_WITHOUT_FRONTMATTER = `# Just a heading

No frontmatter here.`;

const EMPTY_FRONTMATTER = `---
---

Some content without frontmatter keys.`;

// --- Tests ---

let tmpDir: string;
let workdir: string;
let app: Hono;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-skill-api-'));
  workdir = tmpDir;
  const skillsRoot = path.join(workdir, '.claude', 'skills');

  // Create a skill with SKILL.md
  fs.mkdirSync(path.join(skillsRoot, 'my-skill'), { recursive: true });
  fs.writeFileSync(path.join(skillsRoot, 'my-skill', 'SKILL.md'), VALID_SKILL_MD, 'utf-8');
  fs.writeFileSync(path.join(skillsRoot, 'my-skill', 'helper.ts'), '// helper', 'utf-8');

  // Create a skill directory without SKILL.md
  fs.mkdirSync(path.join(skillsRoot, 'no-md'), { recursive: true });
  fs.writeFileSync(path.join(skillsRoot, 'no-md', 'readme.txt'), 'hello', 'utf-8');

  // Create an empty skill directory
  fs.mkdirSync(path.join(skillsRoot, 'empty-skill'), { recursive: true });

  app = new Hono();
  registerWorkdirSkillRoutes(app, { skillsDir: skillsRoot });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/admin/workdir-skills', () => {
  it('lists all skill directories in the workdir', async () => {
    const res = await app.request(`/api/admin/workdir-skills?path=${encodeURIComponent(workdir)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ name: string; hasSkillMd: boolean; fileCount: number }>;
    expect(body).toHaveLength(3);

    const mySkill = body.find((s) => s.name === 'my-skill');
    expect(mySkill).toBeDefined();
    expect(mySkill!.hasSkillMd).toBe(true);
    expect(mySkill!.fileCount).toBe(2);

    const noMd = body.find((s) => s.name === 'no-md');
    expect(noMd).toBeDefined();
    expect(noMd!.hasSkillMd).toBe(false);
    expect(noMd!.fileCount).toBe(1);

    const empty = body.find((s) => s.name === 'empty-skill');
    expect(empty).toBeDefined();
    expect(empty!.hasSkillMd).toBe(false);
    expect(empty!.fileCount).toBe(0);
  });

  it('returns empty array when no .claude/skills directory', async () => {
    const otherDir = path.join(tmpDir, 'no-skills-here');
    fs.mkdirSync(otherDir, { recursive: true });
    const res = await app.request(`/api/admin/workdir-skills?path=${encodeURIComponent(otherDir)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

describe('GET /api/admin/workdir-skills/:name', () => {
  it('returns skill content when SKILL.md exists', async () => {
    const res = await app.request(`/api/admin/workdir-skills/my-skill?path=${encodeURIComponent(workdir)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; content: string; exists: boolean; otherFiles: string[] };
    expect(body.name).toBe('my-skill');
    expect(body.exists).toBe(true);
    expect(body.content).toContain('# Test Skill');
    expect(body.content).toContain('name: test-skill');
    expect(body.otherFiles).toContain('helper.ts');
    expect(body.otherFiles).not.toContain('SKILL.md');
  });

  it('returns exists: false when skill has no SKILL.md', async () => {
    const res = await app.request(`/api/admin/workdir-skills/no-md?path=${encodeURIComponent(workdir)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; exists: boolean };
    expect(body.name).toBe('no-md');
    expect(body.exists).toBe(false);
  });

  it('returns exists: false when skill directory does not exist', async () => {
    const res = await app.request(`/api/admin/workdir-skills/nonexistent?path=${encodeURIComponent(workdir)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; exists: boolean };
    expect(body.name).toBe('nonexistent');
    expect(body.exists).toBe(false);
  });

  it('returns 404 for path traversal attempts (rejected by router)', async () => {
    // Hono normalizes .. segments before matching, so the route never matches
    const res = await app.request(`/api/admin/workdir-skills/../etc?path=${encodeURIComponent(workdir)}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid skill name with special characters', async () => {
    const res = await app.request(`/api/admin/workdir-skills/my%20skill?path=${encodeURIComponent(workdir)}`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid skill name');
  });
});

describe('PUT /api/admin/workdir-skills/:name', () => {
  it('updates SKILL.md with valid frontmatter', async () => {
    const newContent = `---
name: updated-skill
description: Updated description
---

# Updated Skill

New body content.
`;
    const res = await app.request(`/api/admin/workdir-skills/my-skill?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { updated: boolean };
    expect(body.updated).toBe(true);

    // Verify file was actually written
    const diskContent = fs.readFileSync(
      path.join(workdir, '.claude', 'skills', 'my-skill', 'SKILL.md'),
      'utf-8',
    );
    expect(diskContent).toBe(newContent);
  });

  it('creates a new skill directory and SKILL.md if it does not exist', async () => {
    const newContent = `---
name: brand-new-skill
description: A brand new skill
---

# Brand New
`;
    const res = await app.request(`/api/admin/workdir-skills/brand-new?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { updated: boolean };
    expect(body.updated).toBe(true);

    const diskPath = path.join(workdir, '.claude', 'skills', 'brand-new', 'SKILL.md');
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath, 'utf-8')).toBe(newContent);
  });

  it('returns 400 for content without frontmatter', async () => {
    const res = await app.request(`/api/admin/workdir-skills/my-skill?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: SKILL_WITHOUT_FRONTMATTER }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('missing or empty frontmatter');
  });

  it('returns 400 for content with empty frontmatter (no keys)', async () => {
    const res = await app.request(`/api/admin/workdir-skills/my-skill?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: EMPTY_FRONTMATTER }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('missing or empty frontmatter');
  });

  it('returns 400 for empty content string', async () => {
    const res = await app.request(`/api/admin/workdir-skills/my-skill?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('non-empty string');
  });

  it('returns 400 for whitespace-only content', async () => {
    const res = await app.request(`/api/admin/workdir-skills/my-skill?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '   \n\t  ' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('non-empty string');
  });

  it('returns 400 for non-string content', async () => {
    const res = await app.request(`/api/admin/workdir-skills/my-skill?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 42 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('non-empty string');
  });

  it('returns 404 for path traversal in skill name (rejected by router)', async () => {
    const res = await app.request(`/api/admin/workdir-skills/../../../etc?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: VALID_SKILL_MD }),
    });
    expect(res.status).toBe(404);
  });

  it('does not modify other files in the skill directory', async () => {
    const helperPath = path.join(workdir, '.claude', 'skills', 'my-skill', 'helper.ts');
    const originalHelper = fs.readFileSync(helperPath, 'utf-8');

    const newContent = `---
name: updated-skill
description: Updated
---

# Updated
`;
    const res = await app.request(`/api/admin/workdir-skills/my-skill?path=${encodeURIComponent(workdir)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });
    expect(res.status).toBe(200);

    // helper.ts should be unchanged
    expect(fs.readFileSync(helperPath, 'utf-8')).toBe(originalHelper);
  });
});
