import { isAbsolute, resolve } from 'node:path';
import type { Config } from './config.js';
import { isEnvVarUnset } from './config.js';

export type RuntimeProfileSource = 'default' | 'config' | 'profile';

export interface RuntimeProfile {
  source: RuntimeProfileSource;
  name?: string;
  rootDir: string;
  configPath: string;
}

export interface RuntimeEnv {
  [key: string]: string | undefined;
}

interface ParsedRuntimeArgs {
  configPath?: string;
  profileName?: string;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseRuntimeArgs(argv: string[]): ParsedRuntimeArgs {
  const parsed: ParsedRuntimeArgs = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      parsed.configPath = readFlagValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--config=')) {
      parsed.configPath = arg.slice('--config='.length);
      continue;
    }
    if (arg === '--profile') {
      parsed.profileName = readFlagValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      parsed.profileName = arg.slice('--profile='.length);
      continue;
    }
    if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (!parsed.configPath && positional[0]) {
    parsed.configPath = positional[0];
  }
  return parsed;
}

function normalizeProfileName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
    throw new Error(`Invalid runtime profile name: ${trimmed}`);
  }
  return trimmed;
}

function resolvePath(cwd: string, value: string): string {
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function expandEnvPlaceholder(value: string, env: RuntimeEnv): string | undefined {
  const match = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return undefined;
  return env[match[1]];
}

export function resolveRuntimeProfile(
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env: RuntimeEnv = process.env,
): RuntimeProfile {
  const args = parseRuntimeArgs(argv);
  const envConfig = env.HAPPYCOMPANY_CONFIG?.trim();
  const profileName = normalizeProfileName(args.profileName ?? env.HAPPYCOMPANY_PROFILE);
  const configPath = args.configPath ?? (envConfig || undefined);

  if (configPath) {
    return {
      source: 'config',
      name: profileName,
      rootDir: cwd,
      configPath: resolvePath(cwd, configPath),
    };
  }

  if (profileName) {
    const rootDir = resolve(cwd, '.runtime', profileName);
    return {
      source: 'profile',
      name: profileName,
      rootDir,
      configPath: resolve(rootDir, 'config.json'),
    };
  }

  return {
    source: 'default',
    rootDir: cwd,
    configPath: resolve(cwd, 'config.json'),
  };
}

function resolveProfilePath(profile: RuntimeProfile, value: string | undefined, fallbackName: string): string | undefined {
  if (profile.source !== 'profile') return value;
  if (!value || isEnvVarUnset(value)) return resolve(profile.rootDir, fallbackName);
  return resolvePath(profile.rootDir, value);
}

export function resolveRuntimeDataDir(
  rawConfig: Record<string, unknown>,
  profile: RuntimeProfile,
  env: RuntimeEnv = process.env,
): string {
  const rawDataDir = typeof rawConfig.dataDir === 'string' ? rawConfig.dataDir : undefined;
  const dataDir = rawDataDir ? (expandEnvPlaceholder(rawDataDir, env) ?? rawDataDir) : undefined;
  return resolveProfilePath(profile, dataDir, 'data') ?? (dataDir || 'data');
}

export function applyRuntimeProfileDefaults(config: Config, profile: RuntimeProfile): Config {
  const dataDir = resolveProfilePath(profile, config.dataDir, 'data') ?? config.dataDir;
  const corpDir = resolveProfilePath(profile, config.corpDir, 'corp') ?? config.corpDir;

  return {
    ...config,
    dataDir,
    ...(corpDir ? { corpDir } : {}),
  };
}
