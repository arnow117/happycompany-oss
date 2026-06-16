import { z } from 'zod';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { loadOrCreateKey, decryptCredentials, encryptCredentials, hasPlaintextCredentials } from './crypto.js';

// ── Schemas ──────────────────────────────────────────────

const BotSchema = z.object({
  channel: z.enum(['feishu', 'dingtalk', 'web']),
  credentials: z.record(z.string(), z.string()).optional(),
  displayName: z.string(),
  reactionEmoji: z.string().optional(),
  agentDir: z.string(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  authToken: z.string().optional(),
  hidden: z.boolean().optional(),
  tenant: z.string().optional(),
  routingMode: z.enum(['direct', 'employee-director']).optional(),
  groupReplyMode: z.enum(['mention-only', 'all']).optional(),
});

const ClaudeSchema = z
  .object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    authToken: z.string().optional(),
    model: z.string().optional(),
    directorEnabled: z.boolean().optional(),
    directorModel: z.string().optional(),
    maxStackDepth: z.number().int().min(1).max(10).optional(),
  })
  .optional();

const WebSchema = z.object({
  port: z.number().default(3100),
});

export const DEFAULT_WEB_CHAT_CONFIG = {
  welcomeTitle: '你好，有什么可以帮你？',
  welcomeSubtitle: '选择下方话题快速开始，或直接输入你的问题。',
  inputPlaceholder: '输入消息... (Enter 发送)',
  historyLimit: 50,
  enableImageUpload: true,
  showSessionPicker: true,
  showQuickPrompts: true,
};

const WebChatSchema = z
  .object({
    welcomeTitle: z.string().default(DEFAULT_WEB_CHAT_CONFIG.welcomeTitle),
    welcomeSubtitle: z.string().default(DEFAULT_WEB_CHAT_CONFIG.welcomeSubtitle),
    inputPlaceholder: z.string().default(DEFAULT_WEB_CHAT_CONFIG.inputPlaceholder),
    historyLimit: z.number().int().min(10).max(200).default(DEFAULT_WEB_CHAT_CONFIG.historyLimit),
    enableImageUpload: z.boolean().default(DEFAULT_WEB_CHAT_CONFIG.enableImageUpload),
    showSessionPicker: z.boolean().default(DEFAULT_WEB_CHAT_CONFIG.showSessionPicker),
    showQuickPrompts: z.boolean().default(DEFAULT_WEB_CHAT_CONFIG.showQuickPrompts),
  })
  .default(DEFAULT_WEB_CHAT_CONFIG);

const ConfigSchema = z.object({
  bots: z.record(z.string(), BotSchema),
  claude: ClaudeSchema,
  web: WebSchema.default({ port: 8889 }),
  webChat: WebChatSchema,
  dataDir: z.string().default('data'),
  corpDir: z.string().optional(),
  adminToken: z.string().optional(),
});

// ── Types ────────────────────────────────────────────────

export type Config = z.infer<typeof ConfigSchema>;

// ── Env expansion ────────────────────────────────────────

export function isEnvVarUnset(value: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
    if (match) {
      const envVal = process.env[match[1]];
      if (envVal === undefined) {
        return value;
      }
      return envVal;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = expandEnvVars(val);
    }
    return result;
  }

  return value;
}

// ── Credential encryption helpers ────────────────────────

function decryptConfigCredentials(raw: Record<string, unknown>, key: Buffer): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key2, val] of Object.entries(raw)) {
    if (key2 === 'bots' && val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const bots: Record<string, unknown> = {};
      for (const [botName, botVal] of Object.entries(val as Record<string, unknown>)) {
        if (botVal !== null && typeof botVal === 'object' && !Array.isArray(botVal)) {
          const bot = botVal as Record<string, unknown>;
          if (bot.credentials && typeof bot.credentials === 'object' && !Array.isArray(bot.credentials)) {
            bots[botName] = {
              ...bot,
              credentials: decryptCredentials(
                bot.credentials as Record<string, string>,
                key,
              ),
            };
          } else {
            bots[botName] = botVal;
          }
        } else {
          bots[botName] = botVal;
        }
      }
      result[key2] = bots;
    } else {
      result[key2] = val;
    }
  }
  return result;
}

function encryptConfigCredentials(config: Config, key: Buffer): Record<string, unknown> {
  const bots: Record<string, unknown> = {};
  for (const [name, bot] of Object.entries(config.bots)) {
    bots[name] = {
      ...bot,
      credentials: bot.credentials ? encryptCredentials(bot.credentials, key) : {},
    };
  }
  return {
    ...config,
    bots,
  };
}

// ── Loader ───────────────────────────────────────────────

export function loadConfig(path: string, keyPath?: string): Config {
  const raw = readFileSync(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const expanded = expandEnvVars(parsed) as Record<string, unknown>;

  let result = expanded;
  if (keyPath) {
    const key = loadOrCreateKey(keyPath);
    result = decryptConfigCredentials(result, key);
  }

  return ConfigSchema.parse(result);
}

export function saveConfig(path: string, config: Config, keyPath: string): void {
  const key = loadOrCreateKey(keyPath);
  const encrypted = encryptConfigCredentials(config, key);
  const tmpFile = `${path}.${process.pid}-${Date.now()}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(encrypted, null, 2), 'utf-8');
  renameSync(tmpFile, path);
}

export { hasPlaintextCredentials };

export function reloadConfig(path: string, keyPath?: string): Config {
  return loadConfig(path, keyPath);
}

export interface ConfigDelta {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffConfigs(oldConfig: Config, newConfig: Config): ConfigDelta {
  const oldNames = new Set(Object.keys(oldConfig.bots));
  const newNames = new Set(Object.keys(newConfig.bots));

  const added = [...newNames].filter((n) => !oldNames.has(n));
  const removed = [...oldNames].filter((n) => !newNames.has(n));
  const changed: string[] = [];

  for (const name of newNames) {
    if (added.includes(name)) continue;
    const oldBot = oldConfig.bots[name];
    const newBot = newConfig.bots[name];
    if (
      JSON.stringify(oldBot.credentials) !== JSON.stringify(newBot.credentials) ||
      oldBot.channel !== newBot.channel ||
      oldBot.model !== newBot.model ||
      oldBot.cwd !== newBot.cwd ||
      oldBot.baseUrl !== newBot.baseUrl ||
      oldBot.authToken !== newBot.authToken ||
      oldBot.tenant !== newBot.tenant ||
      oldBot.routingMode !== newBot.routingMode ||
      oldBot.groupReplyMode !== newBot.groupReplyMode
    ) {
      changed.push(name);
    }
  }

  return { added, removed, changed };
}
