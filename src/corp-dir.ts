import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function isEnvPlaceholder(value: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function explicitCorpDir(cwd: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || isEnvPlaceholder(trimmed)) return undefined;
  return resolve(cwd, trimmed);
}

export function resolveCorpDir(cwd = process.cwd(), configuredCorpDir?: string): string {
  const envCorpDir = explicitCorpDir(cwd, process.env.HAPPYCOMPANY_CORP_DIR);
  if (envCorpDir) return envCorpDir;

  const configCorpDir = explicitCorpDir(cwd, configuredCorpDir);
  if (configCorpDir) return configCorpDir;

  // Prefer repo-local corp so runtime writes stay inside this project.
  const localCorp = resolve(cwd, 'corp');
  if (existsSync(localCorp)) {
    return localCorp;
  }

  // Legacy workspaces kept corp as a sibling of the repo.
  return resolve(cwd, '..', 'corp');
}
