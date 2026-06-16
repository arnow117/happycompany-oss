import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, diffConfigs } from '../src/config.js';
import type { Config } from '../src/config.js';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Clean up env vars set during tests
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.DINGTALK_CLIENT_ID;
    delete process.env.DINGTALK_CLIENT_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.HAPPYCOMPANY_CORP_DIR;
    delete process.env.MISSING_VAR;
  });

  function writeConfigFile(config: object, filename = 'config.json'): string {
    const path = join(tempDir, filename);
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
    return path;
  }

  it('loads a valid feishu config and resolves env vars', () => {
    process.env.FEISHU_APP_ID = 'cli_test123';
    process.env.FEISHU_APP_SECRET = 'secret456';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    const configPath = writeConfigFile({
      bots: {
        'hospital-crm-bot': {
          channel: 'feishu',
          credentials: {
            appId: '$FEISHU_APP_ID',
            appSecret: '$FEISHU_APP_SECRET',
          },
          displayName: '医院CRM助手',
          agentDir: './agents/hospital-crm',
          reactionEmoji: 'CROWN',
        },
      },
      claude: { apiKey: '$ANTHROPIC_API_KEY' },
      web: { port: 8889 },
      dataDir: 'data',
    });

    const config: Config = loadConfig(configPath);

    // Bot fields
    expect(Object.keys(config.bots)).toEqual(['hospital-crm-bot']);
    const bot = config.bots['hospital-crm-bot'];
    expect(bot.channel).toBe('feishu');
    expect(bot.credentials.appId).toBe('cli_test123');
    expect(bot.credentials.appSecret).toBe('secret456');
    expect(bot.displayName).toBe('医院CRM助手');
    expect(bot.agentDir).toBe('./agents/hospital-crm');
    expect(bot.reactionEmoji).toBe('CROWN');

    // Claude config
    expect(config.claude?.apiKey).toBe('sk-ant-test');

    // Web config
    expect(config.web.port).toBe(8889);

    // Data dir
    expect(config.dataDir).toBe('data');
  });

  it('preserves $VAR string when env var is missing', () => {
    // Intentionally NOT setting MISSING_VAR
    const configPath = writeConfigFile({
      bots: {
        'test-bot': {
          channel: 'feishu',
          credentials: {
            appId: '$MISSING_VAR',
            appSecret: 'real-secret',
          },
          displayName: 'Test Bot',
          agentDir: './agents/test',
        },
      },
      claude: {},
      web: { port: 8889 },
      dataDir: 'data',
    });

    const config = loadConfig(configPath);
    expect(config.bots['test-bot'].credentials.appId).toBe('$MISSING_VAR');
  });

  it('loads corpDir and resolves env vars', () => {
    process.env.HAPPYCOMPANY_CORP_DIR = '/srv/happycompany/corp';

    const configPath = writeConfigFile({
      bots: {
        'test-bot': {
          channel: 'web',
          credentials: {},
          displayName: 'Test Bot',
          agentDir: './agents/test',
        },
      },
      claude: {},
      web: { port: 8889 },
      dataDir: 'data',
      corpDir: '$HAPPYCOMPANY_CORP_DIR',
    });

    const config = loadConfig(configPath);
    expect(config.corpDir).toBe('/srv/happycompany/corp');
  });

  it('throws Zod validation error for unknown channel value', () => {
    process.env.FEISHU_APP_ID = 'cli_test';
    process.env.FEISHU_APP_SECRET = 'secret';

    const configPath = writeConfigFile({
      bots: {
        'bad-channel-bot': {
          channel: 'telegram',
          credentials: {
            appId: '$FEISHU_APP_ID',
            appSecret: '$FEISHU_APP_SECRET',
          },
          displayName: 'Bad Channel Bot',
          agentDir: './agents/bad',
        },
      },
      claude: {},
      web: { port: 8889 },
      dataDir: 'data',
    });

    expect(() => loadConfig(configPath)).toThrow();
  });

  it('applies default values for web.port and dataDir', () => {
    process.env.FEISHU_APP_ID = 'cli_def';
    process.env.FEISHU_APP_SECRET = 'sec_def';

    const configPath = writeConfigFile({
      bots: {
        'minimal-bot': {
          channel: 'feishu',
          credentials: {
            appId: '$FEISHU_APP_ID',
            appSecret: '$FEISHU_APP_SECRET',
          },
          displayName: 'Minimal Bot',
          agentDir: './agents/minimal',
        },
      },
    });

    const config: Config = loadConfig(configPath);

    expect(config.web.port).toBe(8889);
    expect(config.dataDir).toBe('data');
    expect(config.claude).toBeUndefined();
  });

  it('loads a valid dingtalk config with clientId/clientSecret', () => {
    process.env.DINGTALK_CLIENT_ID = 'ding_client';
    process.env.DINGTALK_CLIENT_SECRET = 'ding_secret';

    const configPath = writeConfigFile({
      bots: {
        'dingtalk-bot': {
          channel: 'dingtalk',
          credentials: {
            clientId: '$DINGTALK_CLIENT_ID',
            clientSecret: '$DINGTALK_CLIENT_SECRET',
          },
          displayName: '钉钉助手',
          agentDir: './agents/dingtalk',
          reactionEmoji: 'THUMBSUP',
          cwd: '/home/bot',
          model: 'claude-sonnet-4-20250514',
        },
      },
      claude: {},
      web: {},
      dataDir: '/var/bot-data',
    });

    const config: Config = loadConfig(configPath);

    const bot = config.bots['dingtalk-bot'];
    expect(bot.channel).toBe('dingtalk');
    expect(bot.credentials.clientId).toBe('ding_client');
    expect(bot.credentials.clientSecret).toBe('ding_secret');
    expect(bot.reactionEmoji).toBe('THUMBSUP');
    expect(bot.cwd).toBe('/home/bot');
    expect(bot.model).toBe('claude-sonnet-4-20250514');
  });

  it('loads enterprise bot routing fields', () => {
    process.env.DINGTALK_CLIENT_ID = 'ding_enterprise';
    process.env.DINGTALK_CLIENT_SECRET = 'ding_enterprise_secret';

    const configPath = writeConfigFile({
      bots: {
        'acme-dingtalk': {
          channel: 'dingtalk',
          credentials: {
            clientId: '$DINGTALK_CLIENT_ID',
            clientSecret: '$DINGTALK_CLIENT_SECRET',
          },
          displayName: '示例医疗助手',
          agentDir: '../corp/acme',
          cwd: '../corp/acme',
          tenant: 'acme',
          routingMode: 'employee-director',
          groupReplyMode: 'all',
        },
      },
      claude: {},
      web: {},
    });

    const config: Config = loadConfig(configPath);
    const bot = config.bots['acme-dingtalk'];

    expect(bot.tenant).toBe('acme');
    expect(bot.routingMode).toBe('employee-director');
    expect(bot.groupReplyMode).toBe('all');
  });

  it('supports multiple bots in a single config', () => {
    process.env.FEISHU_APP_ID = 'cli_multi';
    process.env.FEISHU_APP_SECRET = 'sec_multi';
    process.env.DINGTALK_CLIENT_ID = 'ding_multi';
    process.env.DINGTALK_CLIENT_SECRET = 'ding_multi_sec';

    const configPath = writeConfigFile({
      bots: {
        'feishu-bot': {
          channel: 'feishu',
          credentials: {
            appId: '$FEISHU_APP_ID',
            appSecret: '$FEISHU_APP_SECRET',
          },
          displayName: '飞书助手',
          agentDir: './agents/feishu',
        },
        'dingtalk-bot': {
          channel: 'dingtalk',
          credentials: {
            clientId: '$DINGTALK_CLIENT_ID',
            clientSecret: '$DINGTALK_CLIENT_SECRET',
          },
          displayName: '钉钉助手',
          agentDir: './agents/dingtalk',
        },
      },
      claude: {},
      web: { port: 8080 },
    });

    const config: Config = loadConfig(configPath);

    expect(Object.keys(config.bots)).toHaveLength(2);
    expect(config.bots['feishu-bot'].channel).toBe('feishu');
    expect(config.bots['dingtalk-bot'].channel).toBe('dingtalk');
    expect(config.web.port).toBe(8080);
  });
});

function makeConfig(bots: Record<string, Config['bots'][string]>): Config {
  return {
    bots,
    claude: {},
    web: { port: 8889 },
    dataDir: 'data',
  };
}

describe('diffConfigs', () => {
  const baseBot = {
    channel: 'feishu' as const,
    credentials: { appId: 'a', appSecret: 's' },
    displayName: 'Test',
    agentDir: './agents/test',
  };

  it('detects added bots', () => {
    const old = makeConfig({ bot1: baseBot });
    const new_ = makeConfig({ bot1: baseBot, bot2: { ...baseBot, displayName: 'New' } });
    const delta = diffConfigs(old, new_);
    expect(delta.added).toEqual(['bot2']);
    expect(delta.removed).toEqual([]);
    expect(delta.changed).toEqual([]);
  });

  it('detects removed bots', () => {
    const old = makeConfig({ bot1: baseBot, bot2: { ...baseBot, displayName: 'Gone' } });
    const new_ = makeConfig({ bot1: baseBot });
    const delta = diffConfigs(old, new_);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual(['bot2']);
    expect(delta.changed).toEqual([]);
  });

  it('detects changed credentials', () => {
    const old = makeConfig({ bot1: baseBot });
    const new_ = makeConfig({ bot1: { ...baseBot, credentials: { appId: 'a', appSecret: 'new-secret' } } });
    const delta = diffConfigs(old, new_);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.changed).toEqual(['bot1']);
  });

  it('detects changed channel', () => {
    const old = makeConfig({ bot1: baseBot });
    const new_ = makeConfig({ bot1: { ...baseBot, channel: 'dingtalk' } });
    const delta = diffConfigs(old, new_);
    expect(delta.changed).toEqual(['bot1']);
  });

  it('detects changed model', () => {
    const old = makeConfig({ bot1: baseBot });
    const new_ = makeConfig({ bot1: { ...baseBot, model: 'claude-opus' } });
    const delta = diffConfigs(old, new_);
    expect(delta.changed).toEqual(['bot1']);
  });

  it('detects changed cwd', () => {
    const old = makeConfig({ bot1: baseBot });
    const new_ = makeConfig({ bot1: { ...baseBot, cwd: '/new/dir' } });
    const delta = diffConfigs(old, new_);
    expect(delta.changed).toEqual(['bot1']);
  });

  it('no changes returns empty arrays', () => {
    const cfg = makeConfig({ bot1: baseBot });
    const delta = diffConfigs(cfg, cfg);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.changed).toEqual([]);
  });

  it('handles full replacement: add + remove + change', () => {
    const old = makeConfig({
      removed: baseBot,
      changed: baseBot,
      unchanged: baseBot,
    });
    const new_ = makeConfig({
      changed: { ...baseBot, credentials: { appId: 'x', appSecret: 'y' } },
      unchanged: baseBot,
      added: { ...baseBot, displayName: 'Brand New' },
    });
    const delta = diffConfigs(old, new_);
    expect(delta.added).toEqual(['added']);
    expect(delta.removed).toEqual(['removed']);
    expect(delta.changed).toEqual(['changed']);
    expect(delta).not.toHaveProperty('unchanged');
  });
});
