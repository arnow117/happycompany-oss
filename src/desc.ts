import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './skills.js';
import { hasCliEntry } from './app-runner.js';

// --- Public API ---

/**
 * Extract a bot-level description from the workdir's CLAUDE.md.
 * Returns the first non-empty paragraph (up to 500 chars) as the bot identity.
 */
export function extractBotDescription(workdir: string): string {
  const claudeMd = path.join(workdir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) return '';

  try {
    const content = fs.readFileSync(claudeMd, 'utf-8');
    // Try frontmatter description first
    const frontmatter = parseFrontmatter(content);
    const desc = frontmatter.description;
    if (desc) {
      return (typeof desc === 'string' ? desc : Array.isArray(desc) ? (desc as string[]).join(' ') : String(desc)).slice(0, 500);
    }

    // Fall back to first non-empty paragraph after frontmatter
    const lines = content.split('\n');
    let pastFrontmatter = false;
    const paragraph: string[] = [];

    for (const line of lines) {
      if (!pastFrontmatter && line.trim() === '---') {
        pastFrontmatter = !pastFrontmatter;
        continue;
      }
      if (!pastFrontmatter) continue;

      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed.startsWith('>') || trimmed.startsWith('---')) {
        if (paragraph.length > 0) break;
        continue;
      }
      if (trimmed === '') {
        if (paragraph.length > 0) break;
        continue;
      }
      paragraph.push(trimmed);
    }

    return paragraph.join(' ').slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Generate a capability description block by reading SKILL.md files
 * from installed apps in the workdir.
 *
 * @returns Formatted capability string, or empty string if no skills found.
 */
export function generateCapabilityDesc(
  workdir: string,
  skillNames?: string[],
): string {
  const entries: Array<{ name: string; description: string; hasCli: boolean }> = [];
  const names = skillNames ?? listSkillNames(workdir);

  for (const appName of names) {
    if (typeof appName !== 'string' || appName.length === 0) continue;

    const skillMd = path.join(
      workdir,
      '.claude',
      'skills',
      appName,
      'SKILL.md',
    );

    if (!fs.existsSync(skillMd)) continue;

    try {
      const content = fs.readFileSync(skillMd, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      const rawName = frontmatter.name;
      const rawDesc = frontmatter.description;
      const name = typeof rawName === 'string'
        ? rawName
        : Array.isArray(rawName) && typeof rawName[0] === 'string'
          ? rawName[0]
          : appName;
      const description = typeof rawDesc === 'string'
        ? rawDesc
        : Array.isArray(rawDesc) && typeof rawDesc[0] === 'string'
          ? rawDesc[0]
          : '';

      if (description) {
        const hasCli = hasCliEntry(workdir, appName);
        entries.push({ name, description, hasCli });
      }
    } catch {
      // Skip unreadable skill files
    }
  }

  if (entries.length === 0) return '';

  const cliApps = entries.filter((e) => e.hasCli);
  const lines = entries.map(
    (entry) => `- **${entry.name}**: ${entry.description}`,
  );

  let result = `## Available Capabilities\n\n${lines.join('\n')}\n`;

  if (cliApps.length > 0) {
    const cliLines = cliApps.map(
      (app) => `- \`${app.name}\`: .claude/skills/${app.name}/bin/run [args...]`,
    );
    result += `\n## CLI Apps\n\nThese apps have executable entry points. Run them via the Bash tool:\n\n${cliLines.join('\n')}\n`;
  }

  return result;
}

function listSkillNames(workdir: string): string[] {
  const skillsDir = path.join(workdir, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Inject capability descriptions into a base system prompt.
 * Appends the capability block only if it is non-empty.
 */
export function injectDescIntoPrompt(
  basePrompt: string,
  capabilities: string,
): string {
  if (!capabilities) return basePrompt;

  return `${basePrompt}\n\n${capabilities}`;
}
