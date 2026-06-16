import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, parseDependencies, hasWriteOps, type SkillDependencies } from './skills.js';
import { skillToolSchema, type SkillToolDef } from './tool-schemas.js';

// --- Types ---

export interface ScannedSkill {
  name: string;
  description: string;
  path: string;
  dependencies?: SkillDependencies;
  hasWriteOps: boolean;
  toolDefs?: SkillToolDef[];
}

export interface ScannedScript {
  path: string;
  relativePath: string;
  executable: boolean;
  shebang?: string;
}

export interface ScanResult {
  path: string;
  skills: ScannedSkill[];
  scripts: ScannedScript[];
  projectContext?: string;
  runtimeDependencies: RuntimeDependencies;
}

export interface RuntimeDependencies {
  hasPackageJson: boolean;
  hasRequirementsTxt: boolean;
  pythonPackages: string[];
  nodePackages: string[];
}

// --- Workdir Scanner ---

export class WorkdirScanner {
  scan(workdirPath: string): ScanResult {
    const normalizedPath = path.resolve(workdirPath);

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`Workdir does not exist: ${normalizedPath}`);
    }

    if (!fs.statSync(normalizedPath).isDirectory()) {
      throw new Error(`Workdir is not a directory: ${normalizedPath}`);
    }

    const skills = this.scanSkills(normalizedPath);
    const scripts = this.scanScripts(normalizedPath);
    const projectContext = this.readProjectContext(normalizedPath);
    const runtimeDependencies = this.scanRuntimeDependencies(normalizedPath);

    return {
      path: normalizedPath,
      skills,
      scripts,
      projectContext,
      runtimeDependencies,
    };
  }

  private scanSkills(workdirPath: string): ScannedSkill[] {
    const skillsDir = path.join(workdirPath, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    const skills: ScannedSkill[] = [];
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const skillDir = path.join(skillsDir, entry.name);
        if (entry.isSymbolicLink()) {
          try {
            if (!fs.statSync(skillDir).isDirectory()) continue;
          } catch {
            continue;
          }
        }

        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const skillMdDisabledPath = path.join(skillDir, 'SKILL.md.disabled');

        let skillFilePath: string | null = null;
        if (fs.existsSync(skillMdPath)) {
          skillFilePath = skillMdPath;
        } else if (fs.existsSync(skillMdDisabledPath)) {
          skillFilePath = skillMdDisabledPath;
        }

        if (!skillFilePath) continue;

        try {
          const content = fs.readFileSync(skillFilePath, 'utf-8');
          const frontmatter = parseFrontmatter(content);
          const name = typeof frontmatter.name === 'string' ? frontmatter.name : entry.name;
          const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
          const dependencies = parseDependencies(frontmatter);
          const hasWriteOpsFlag = hasWriteOps(frontmatter);

          // Parse tool definitions from frontmatter tools array
          const toolsRaw = frontmatter['tools'];
          let toolDefs: SkillToolDef[] | undefined;
          if (Array.isArray(toolsRaw) && toolsRaw.length > 0) {
            const validDefs: SkillToolDef[] = [];
            for (const t of toolsRaw) {
              const parsed = skillToolSchema.safeParse(t);
              if (parsed.success) validDefs.push(parsed.data);
            }
            if (validDefs.length > 0) toolDefs = validDefs;
          }

          skills.push({
            name,
            description,
            path: skillDir,
            dependencies,
            hasWriteOps: hasWriteOpsFlag,
            toolDefs,
          });
        } catch {
          // Skip malformed skills
        }
      }
    } catch {
      // Skip if directory is not readable
    }

    return skills;
  }

  private scanScripts(workdirPath: string): ScannedScript[] {
    const binDir = path.join(workdirPath, 'bin');
    if (!fs.existsSync(binDir)) return [];

    const scripts: ScannedScript[] = [];
    try {
      const entries = fs.readdirSync(binDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const fullPath = path.join(binDir, entry.name);
        const relativePath = path.relative(workdirPath, fullPath);

        let executable = false;
        let shebang: string | undefined;

        try {
          const stats = fs.statSync(fullPath);
          executable = (stats.mode & fs.constants.S_IXUSR) !== 0;

          if (stats.size > 0 && stats.size < 1024) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.startsWith('#!')) {
              const endOfLine = content.indexOf('\n');
              shebang = endOfLine === -1 ? content : content.slice(0, endOfLine);
            }
          }
        } catch {
          // Skip files that cannot be read
          continue;
        }

        scripts.push({
          path: fullPath,
          relativePath,
          executable,
          shebang,
        });
      }
    } catch {
      // Skip if directory is not readable
    }

    return scripts;
  }

  private readProjectContext(workdirPath: string): string | undefined {
    const claudeMdPath = path.join(workdirPath, 'CLAUDE.md');
    const agentsMdPath = path.join(workdirPath, 'AGENTS.md');

    try {
      if (fs.existsSync(claudeMdPath)) {
        return fs.readFileSync(claudeMdPath, 'utf-8');
      }
      if (fs.existsSync(agentsMdPath)) {
        return fs.readFileSync(agentsMdPath, 'utf-8');
      }
    } catch {
      // Skip if file cannot be read
    }

    return undefined;
  }

  private scanRuntimeDependencies(workdirPath: string): RuntimeDependencies {
    const packageJsonPath = path.join(workdirPath, 'package.json');
    const requirementsTxtPath = path.join(workdirPath, 'requirements.txt');

    const hasPackageJson = fs.existsSync(packageJsonPath);
    const hasRequirementsTxt = fs.existsSync(requirementsTxtPath);

    let pythonPackages: string[] = [];
    let nodePackages: string[] = [];

    try {
      if (hasRequirementsTxt) {
        const content = fs.readFileSync(requirementsTxtPath, 'utf-8');
        pythonPackages = content
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line && !line.startsWith('#'))
          .map((line: string) => {
            const match = line.match(/^([a-zA-Z0-9_-]+)/);
            return match ? match[1] : line.split('==')[0].split('>=')[0];
          });
      }
    } catch {
      // Skip if file cannot be read
    }

    try {
      if (hasPackageJson) {
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content) as Record<string, unknown>;
        const deps = packageJson.dependencies as Record<string, string> | undefined;
        if (deps) {
          nodePackages = Object.keys(deps);
        }
      }
    } catch {
      // Skip if file cannot be parsed
    }

    return {
      hasPackageJson,
      hasRequirementsTxt,
      pythonPackages,
      nodePackages,
    };
  }
}

// --- Path Validation ---

export function isValidPath(workdirPath: string, filePath: string): boolean {
  const normalizedWorkdir = path.resolve(workdirPath);
  const normalizedFile = path.resolve(filePath);

  const relative = path.relative(normalizedWorkdir, normalizedFile);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
