import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Types ──────────────────────────────────────────────────

export interface LoadedPrompt {
  system: string;
  user?: string;
}

// ── Internal ───────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, 'templates');
const snippetsDir = join(__dirname, 'snippets');

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
}

/** Replace {{snippet:name}} with snippet file content (non-recursive). */
function processSnippets(template: string): string {
  return template.replace(/\{\{snippet:(\S+?)}}/g, (_, name: string) => {
    const snippetPath = join(snippetsDir, `${name}.md`);
    return readIfExists(snippetPath) ?? `<!-- snippet not found: ${name} -->`;
  });
}

/** Replace {{variable}} placeholders. */
function interpolateVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)}}/g, (_, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

// ── Public API ─────────────────────────────────────────────

/** Load raw system + user templates for a prompt id. */
export function loadPrompt(promptId: string): LoadedPrompt {
  const dir = join(templatesDir, promptId);
  return {
    system: readFileSync(join(dir, 'system.md'), 'utf-8'),
    user: readIfExists(join(dir, 'user.md')),
  };
}

/**
 * Full pipeline: load → snippets → interpolate → combine.
 * Returns { system, user? } with all processing applied.
 */
export function buildPrompt(
  promptId: string,
  vars: Record<string, string> = {},
): LoadedPrompt {
  const raw = loadPrompt(promptId);
  return {
    system: interpolateVariables(processSnippets(raw.system), vars),
    user: raw.user ? interpolateVariables(processSnippets(raw.user), vars) : undefined,
  };
}
