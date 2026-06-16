/**
 * Environment variable sanitization for custom app execution.
 *
 * Prevents user-supplied env vars from overriding runtime-critical
 * variables (LD_PRELOAD, PATH, etc.) or leaking platform secrets.
 */

// ---------------------------------------------------------------------------
// Code execution / preload
// ---------------------------------------------------------------------------
const CODE_EXEC_VARS = new Set([
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'NODE_OPTIONS',
  'JAVA_TOOL_OPTIONS',
  'PERL5OPT',
]);

// ---------------------------------------------------------------------------
// Path manipulation
// ---------------------------------------------------------------------------
const PATH_VARS = new Set([
  'PATH',
  'PYTHONPATH',
  'RUBYLIB',
  'PERL5LIB',
  'GIT_EXEC_PATH',
  'CDPATH',
]);

// ---------------------------------------------------------------------------
// Shell behavior
// ---------------------------------------------------------------------------
const SHELL_VARS = new Set(['BASH_ENV', 'ENV', 'PROMPT_COMMAND', 'ZDOTDIR']);

// ---------------------------------------------------------------------------
// Editor / terminal
// ---------------------------------------------------------------------------
const EDITOR_VARS = new Set(['EDITOR', 'VISUAL', 'PAGER']);

// ---------------------------------------------------------------------------
// SSH / Git credentials
// ---------------------------------------------------------------------------
const SSH_GIT_VARS = new Set([
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
]);

// ---------------------------------------------------------------------------
// Sensitive directories
// ---------------------------------------------------------------------------
const DIR_VARS = new Set(['HOME', 'TMPDIR', 'TEMP', 'TMP']);

// ---------------------------------------------------------------------------
// Platform internal
// ---------------------------------------------------------------------------
const PLATFORM_VARS = new Set([
  'UNIFIED_PLATFORM_WORKSPACE_GROUP',
  'UNIFIED_PLATFORM_WORKSPACE_GLOBAL',
  'UNIFIED_PLATFORM_WORKSPACE_IPC',
  'CLAUDE_CONFIG_DIR',
]);

// ---------------------------------------------------------------------------
// Union of all dangerous environment variable names (35 entries)
// ---------------------------------------------------------------------------
export const DANGEROUS_ENV_VARS: Set<string> = new Set([
  ...CODE_EXEC_VARS,
  ...PATH_VARS,
  ...SHELL_VARS,
  ...EDITOR_VARS,
  ...SSH_GIT_VARS,
  ...DIR_VARS,
  ...PLATFORM_VARS,
]);

// ---------------------------------------------------------------------------
// Claude Code / Anthropic keys that must never be exposed to apps
// ---------------------------------------------------------------------------
export const RESERVED_CLAUDE_ENV_KEYS: Set<string> = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_MODEL',
]);

// ---------------------------------------------------------------------------
// Maximum number of custom env vars a single app may define
// ---------------------------------------------------------------------------
export const MAX_CUSTOM_ENV_ENTRIES = 50;

// ---------------------------------------------------------------------------
// sanitizeEnv
// ---------------------------------------------------------------------------

/**
 * Returns a new object containing only safe environment variables.
 *
 * Variables present in `DANGEROUS_ENV_VARS` or `RESERVED_CLAUDE_ENV_KEYS`
 * are stripped. A `console.warn` is emitted for each removed key so
 * operators can detect misconfigurations.
 */
export function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const blocked = new Set([...DANGEROUS_ENV_VARS, ...RESERVED_CLAUDE_ENV_KEYS]);
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (blocked.has(key)) {
      console.warn(`[env-guard] blocked dangerous env var: ${key}`);
      continue;
    }
    result[key] = value;
  }

  return result;
}
