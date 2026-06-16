import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { toolManifestSchema } from './tool-schemas.js';
import type { ToolManifest, RegisteredTool, SkillSummary, RegisteredSkillServer } from './types.js';

export class ToolRegistry {
  private readonly corpDir: string;
  private tools = new Map<string, RegisteredTool>();
  private manifests = new Map<string, ToolManifest>();
  private tenantSkills = new Map<string, string[]>();
  private skillDirs = new Map<string, string>();

  constructor(corpDir: string) {
    this.corpDir = corpDir;
  }

  scan(): void {
    this.tools.clear();
    this.manifests.clear();
    this.tenantSkills.clear();
    this.skillDirs.clear();

    if (!fs.existsSync(this.corpDir)) {
      logger.warn({ corpDir: this.corpDir }, 'corp directory does not exist');
      return;
    }

    const tenants = fs.readdirSync(this.corpDir, { withFileTypes: true });
    for (const tenant of tenants) {
      if (!tenant.isDirectory()) continue;

      const skillsDir = path.join(this.corpDir, tenant.name, '.claude', 'skills');
      if (!fs.existsSync(skillsDir)) continue;

      const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const skill of skillDirs) {
        if (skill.name.startsWith('_')) continue;
        if (!skill.isDirectory() && !skill.isSymbolicLink()) continue;
        const skillDirPath = path.join(skillsDir, skill.name);
        let realPath: string;
        try {
          realPath = fs.realpathSync(skillDirPath);
        } catch {
          logger.warn({ skill: skill.name, tenant: tenant.name }, 'Broken symlink or inaccessible skill directory, skipping');
          continue;
        }
        const tenantDir = fs.realpathSync(path.join(this.corpDir, tenant.name));
        if (!realPath.startsWith(tenantDir + path.sep) && realPath !== tenantDir) {
          logger.warn({ skill: skill.name, tenant: tenant.name, realPath }, 'Skill symlink points outside tenant directory, skipping');
          continue;
        }
        if (!fs.statSync(realPath).isDirectory()) continue;

        const toolsJsonPath = path.join(skillsDir, skill.name, 'tools.json');
        if (!fs.existsSync(toolsJsonPath)) continue;

        try {
          const raw = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8'));
          const manifest = toolManifestSchema.parse(raw);
          if (manifest.name !== skill.name) {
            logger.warn(
              { path: toolsJsonPath, manifestName: manifest.name, skillName: skill.name },
              'Skill tools.json name does not match directory, skipping',
            );
            continue;
          }
          this.registerTenantSkill(tenant.name, skill.name, manifest, realPath);
        } catch (err) {
          logger.warn({ path: toolsJsonPath, err }, 'Failed to parse tools.json, skipping');
        }
      }
    }

    logger.info(
      { toolCount: this.tools.size, tenants: this.tenantSkills.size },
      'ToolRegistry scan complete',
    );
  }

  private registerTenantSkill(tenantName: string, skillName: string, manifest: ToolManifest, skillDir: string): void {
    const key = `${tenantName}:${skillName}`;
    this.manifests.set(key, manifest);
    this.skillDirs.set(key, skillDir);

    if (!this.tenantSkills.has(tenantName)) {
      this.tenantSkills.set(tenantName, []);
    }
    this.tenantSkills.get(tenantName)!.push(key);

    for (const toolDef of manifest.tools) {
      const namespacedName = `${skillName}:${toolDef.name}`;
      const registered: RegisteredTool = {
        ...toolDef,
        namespacedName,
        skillName,
        skillDir,
        appName: skillName,
        tenantName,
        hasServer: !!manifest.server,
      };
      this.tools.set(`${tenantName}:${namespacedName}`, registered);
    }
  }

  lookup(tenantName: string, namespacedName: string): RegisteredTool | undefined {
    return this.tools.get(`${tenantName}:${namespacedName}`);
  }

  getToolsForTenant(tenantName: string): RegisteredTool[] {
    const keys = this.tenantSkills.get(tenantName);
    if (!keys) return [];

    const result: RegisteredTool[] = [];
    for (const key of keys) {
      const manifest = this.manifests.get(key);
      if (!manifest) continue;
      for (const toolDef of manifest.tools) {
        const registered = this.tools.get(`${tenantName}:${manifest.name}:${toolDef.name}`);
        if (registered) result.push(registered);
      }
    }
    return result;
  }

  getSkillSummaries(tenantName: string): SkillSummary[] {
    const keys = this.tenantSkills.get(tenantName);
    if (!keys) return [];

    return keys.map((key) => {
      const manifest = this.manifests.get(key);
      if (!manifest) return null;
      return {
        name: manifest.name,
        displayName: manifest.displayName ?? manifest.name,
        description: manifest.description ?? '',
        toolCount: manifest.tools.length,
        hasServer: !!manifest.server,
      };
    }).filter((s): s is SkillSummary => s !== null);
  }

  getAppSummaries(tenantName: string): SkillSummary[] {
    return this.getSkillSummaries(tenantName);
  }

  getAllTenantNames(): string[] {
    return Array.from(this.tenantSkills.keys());
  }

  getSkillTools(tenantName: string, skillName: string): RegisteredTool[] {
    const manifest = this.manifests.get(`${tenantName}:${skillName}`);
    if (!manifest) return [];

    const result: RegisteredTool[] = [];
    for (const toolDef of manifest.tools) {
      const registered = this.tools.get(`${tenantName}:${skillName}:${toolDef.name}`);
      if (registered) result.push(registered);
    }
    return result;
  }

  getAppTools(tenantName: string, appName: string): RegisteredTool[] {
    return this.getSkillTools(tenantName, appName);
  }

  getManifest(tenantName: string, skillName: string): ToolManifest | undefined {
    return this.manifests.get(`${tenantName}:${skillName}`);
  }

  getSkillServers(): RegisteredSkillServer[] {
    const result: RegisteredSkillServer[] = [];
    for (const [key, manifest] of this.manifests.entries()) {
      if (!manifest.server) continue;
      const [tenantName, skillName] = key.split(':', 2);
      const cwd = this.skillDirs.get(key);
      if (!tenantName || !skillName || !cwd) continue;
      result.push({
        tenantName,
        skillName,
        appName: skillName,
        cwd,
        entry: manifest.server.entry,
        python: manifest.server.python,
      });
    }
    return result;
  }

  getAppServers(): RegisteredSkillServer[] {
    return this.getSkillServers();
  }
}
