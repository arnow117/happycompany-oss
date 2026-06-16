import fs from 'node:fs';
import path from 'node:path';

// --- Types ---

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  userInvocable: boolean;
  allowedTools: string[];
  argumentHint: string | null;
  updatedAt: string;
  files: Array<{ name: string; type: 'file' | 'directory'; size: number }>;
  dependencies?: SkillDependencies;
}

export interface SkillDependencies {
  runtime?: string;
  hasWriteOps?: boolean;
  packages?: string[];
  scripts?: Array<{ path: string; access: 'exec' | 'read' }>;
}

// --- Validation ---

/**
 * Validate that a skill ID contains only word chars and hyphens.
 * Prevents directory traversal and special character injection.
 */
export function validateSkillId(id: string): boolean {
  return /^[\w\-]+$/.test(id);
}

/**
 * Validate that a skill directory path does not escape the skills root.
 * Uses path.resolve (not realpath) so symlinked skills whose targets
 * live outside skillsRoot still pass validation.
 */
export function validateSkillPath(
  skillsRoot: string,
  skillDir: string,
): boolean {
  const normalizedRoot = path.resolve(skillsRoot);
  const normalizedDir = path.resolve(skillDir);
  const relative = path.relative(normalizedRoot, normalizedDir);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// --- Frontmatter Parsing ---

/**
 * Split a string by commas while respecting nested braces/brackets.
 * Used to parse comma-separated key:value pairs inside frontmatter list items
 * where values may contain JSON objects.
 */
function splitRespectingBraces(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' || s[i] === '[') depth++;
    else if (s[i] === '}' || s[i] === ']') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += s[i];
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Try to parse a string as a JSON or scalar value.
 * Returns the parsed value if it looks like JSON/boolean/integer, otherwise the raw string.
 */
function tryParseJsonValue(val: string): unknown {
  if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
    try { return JSON.parse(val); } catch { return val; }
  }
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  return val;
}

/**
 * Parse a list of dash-prefixed frontmatter values into either
 * plain string arrays or arrays of parsed objects (when every item
 * contains key:value pairs).
 */
function parseListValues(values: string[]): string[] | Record<string, unknown>[] {
  // Only parse as object array when every item starts with "name:" — this
  // distinguishes tool definitions from other key:value patterns like scripts.
  if (values.length > 0 && values.every(v => /^name:/.test(v.trim()))) {
    return values.map(item => {
      const obj: Record<string, unknown> = {};
      for (const part of splitRespectingBraces(item)) {
        const colonIdx = part.indexOf(':');
        if (colonIdx > 0) {
          const key = part.slice(0, colonIdx).trim();
          obj[key] = tryParseJsonValue(part.slice(colonIdx + 1).trim());
        }
      }
      return obj;
    });
  }
  return values;
}

/**
 * Parse YAML-like frontmatter from markdown content.
 * Supports `>` folded and `|` literal multiline values.
 * Also supports list values for array fields like 'packages' and 'dependencies'.
 * Supports bracket-style array notation: [item1, item2]
 * Supports object-array list items when every item matches key:value patterns.
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return {};

  const endIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (endIndex === -1) return {};

  const frontmatterLines = lines.slice(1, endIndex + 1);
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let multilineMode: 'folded' | 'literal' | 'list' | null = null;

  for (const line of frontmatterLines) {
    const keyMatch = line.match(/^([\w\-]+):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey) {
        result[currentKey] = multilineMode === 'list'
          ? parseListValues(currentValue)
          : currentValue.join(multilineMode === 'literal' ? '\n' : ' ');
      }

      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();

      // Check for bracket-style array notation: [item1, item2]
      if (value.startsWith('[') && value.endsWith(']')) {
        const arrayContent = value.slice(1, -1);
        const items = arrayContent.split(',').map(item => item.trim()).filter(item => item);
        result[currentKey] = items;
        currentKey = null;
        currentValue = [];
        multilineMode = null;
      } else if (value === '>') {
        multilineMode = 'folded';
        currentValue = [];
      } else if (value === '|') {
        multilineMode = 'literal';
        currentValue = [];
      } else if (value === '') {
        multilineMode = 'list';
        currentValue = [];
      } else {
        result[currentKey] = value;
        currentKey = null;
        currentValue = [];
        multilineMode = null;
      }
    } else if (currentKey && multilineMode) {
      const trimmedLine = line.trimStart();
      if (trimmedLine.startsWith('- ')) {
        if (multilineMode !== 'list') {
          multilineMode = 'list';
          currentValue = [];
        }
        currentValue.push(trimmedLine.slice(2));
      } else if (trimmedLine) {
        currentValue.push(trimmedLine);
      }
    }
  }

  if (currentKey) {
    result[currentKey] = multilineMode === 'list'
      ? parseListValues(currentValue)
      : currentValue.join(multilineMode === 'literal' ? '\n' : ' ');
  }

  return result;
}

/**
 * Parse dependencies from frontmatter.
 * Supports nested YAML-like structure for dependencies.
 */
export function parseDependencies(frontmatter: Record<string, unknown>): SkillDependencies | undefined {
  const hasWriteOpsValue = frontmatter['has-write-ops'];
  const hasWriteOps = hasWriteOpsValue === 'true';

  const packages = frontmatter['packages'];
  const packagesArray = Array.isArray(packages)
    ? packages.filter((p): p is string => typeof p === 'string')
    : (typeof packages === 'string' ? packages.split(',').map(p => p.trim()) : undefined);

  const scripts = frontmatter['scripts'];
  let scriptsArray: Array<{ path: string; access: 'exec' | 'read' }> | undefined;
  if (Array.isArray(scripts)) {
    scriptsArray = scripts.filter((s): s is string => typeof s === 'string').map(s => {
      const parts = s.split(',').map(x => x.trim());
      const pathPart = parts.find(p => p.startsWith('path:'))?.replace('path:', '').trim();
      const accessPart = parts.find(p => p.startsWith('access:'))?.replace('access:', '').trim();
      return { path: pathPart || s, access: (accessPart as 'exec' | 'read') || 'read' };
    });
  }

  if (!hasWriteOps && !packagesArray && !scriptsArray) {
    return undefined;
  }

  return {
    ...(hasWriteOps && { hasWriteOps: true }),
    ...(packagesArray && { packages: packagesArray }),
    ...(scriptsArray && { scripts: scriptsArray }),
  };
}

/**
 * Get 'has-write-ops' flag from frontmatter.
 */
export function hasWriteOps(frontmatter: Record<string, unknown>): boolean {
  const value = frontmatter['has-write-ops'];
  return typeof value === 'string' && value === 'true';
}

// --- File Listing ---

/**
 * List files and directories in a directory, with symlink support.
 * Symlinks are resolved to determine their target type.
 * Hidden files (starting with `.`) are skipped.
 */
export function listFiles(
  dir: string,
): Array<{ name: string; type: 'file' | 'directory'; size: number }> {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const result: Array<{
      name: string;
      type: 'file' | 'directory';
      size: number;
    }> = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        try {
          const stats = fs.statSync(fullPath);
          const isDirectory = stats.isDirectory();
          result.push({
            name: entry.name,
            type: isDirectory ? 'directory' : 'file',
            size: isDirectory ? 0 : stats.size,
          });
        } catch {
          // dangling or unreadable symlink
        }
        continue;
      }

      if (entry.isDirectory()) {
        result.push({ name: entry.name, type: 'directory', size: 0 });
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(fullPath).size;
        } catch {
          // treat as size 0 on permission error
        }
        result.push({ name: entry.name, type: 'file', size });
      }
    }
    return result;
  } catch {
    return [];
  }
}

// --- Skill Directory Scanning ---

/**
 * Scan a root directory for skill subdirectories containing SKILL.md.
 * Each subdirectory with a SKILL.md (or SKILL.md.disabled) is parsed
 * into a SkillInfo object.
 */
export function scanSkillDirectory(
  rootDir: string,
  source: string,
): SkillInfo[] {
  const skills: SkillInfo[] = [];
  if (!fs.existsSync(rootDir)) return skills;

  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const skillDir = path.join(rootDir, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          if (!fs.statSync(skillDir).isDirectory()) continue;
        } catch {
          continue;
        }
      }
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      const skillMdDisabledPath = path.join(skillDir, 'SKILL.md.disabled');

      let enabled = false;
      let skillFilePath: string | null = null;

      if (fs.existsSync(skillMdPath)) {
        enabled = true;
        skillFilePath = skillMdPath;
      } else if (fs.existsSync(skillMdDisabledPath)) {
        enabled = false;
        skillFilePath = skillMdDisabledPath;
      } else {
        continue;
      }

      try {
        const content = fs.readFileSync(skillFilePath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const stats = fs.statSync(skillDir);

        const name = typeof frontmatter.name === 'string' ? frontmatter.name : entry.name;
        const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
        const userInvocable =
          frontmatter['user-invocable'] === undefined
            ? true
            : frontmatter['user-invocable'] !== 'false';
        const allowedTools = typeof frontmatter['allowed-tools'] === 'string'
          ? frontmatter['allowed-tools'].split(',').map((t) => t.trim())
          : [];
        const argumentHint = typeof frontmatter['argument-hint'] === 'string' ? frontmatter['argument-hint'] : null;
        const dependencies = parseDependencies(frontmatter);

        skills.push({
          id: entry.name,
          name,
          description,
          source,
          enabled,
          userInvocable,
          allowedTools,
          argumentHint,
          updatedAt: stats.mtime.toISOString(),
          files: listFiles(skillDir),
          dependencies,
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
