import type { Hono } from 'hono';
import * as lark from '@larksuiteoapi/node-sdk';
import type { Config } from '../config.js';
import { saveConfig, isEnvVarUnset } from '../config.js';
import type { MessageBus } from '../bus.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AdminConfigDeps {
  bus: MessageBus;
  configRef: { current: Config };
  configPath: string;
  keyPath: string;
  corpDir?: string;
}

const SENSITIVE_KEY_PARTS = ['apikey', 'authkey', 'authtoken', 'secret', 'password', 'token'];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function maskCredential(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value || isEnvVarUnset(value)) return value;
  return '*'.repeat(value.length);
}

function isMaskedCredential(value: unknown): boolean {
  return typeof value === 'string' && /^\*+$/.test(value);
}

function isUsableCredential(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0 && !isMaskedCredential(value));
}

function mergeCredentials(
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return existing;
  const merged: Record<string, string> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (isMaskedCredential(value) || value === '') continue;
    merged[key] = value;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function requireCredential(
  credentials: Record<string, string> | undefined,
  key: string,
  label: string,
): string {
  const value = credentials?.[key];
  if (!isUsableCredential(value)) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildAnthropicMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

function buildModelVerifyHeaders(authToken: string, mode: 'bearer' | 'api-key'): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(mode === 'bearer' ? { Authorization: `Bearer ${authToken}` } : { 'x-api-key': authToken }),
    'anthropic-version': '2023-06-01',
  };
}

async function verifyFeishuBot(credentials: Record<string, string> | undefined): Promise<{ botOpenId?: string }> {
  const appId = requireCredential(credentials, 'appId', 'Feishu App ID');
  const appSecret = requireCredential(credentials, 'appSecret', 'Feishu App Secret');
  const client = new lark.Client({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild,
  });
  const res = await withTimeout(
    client.request({
      method: 'GET',
      url: '/open-apis/bot/v3/info/',
    }) as Promise<unknown>,
    10_000,
    'Feishu bot verification',
  );
  const data = res as {
    bot?: { open_id?: string };
    data?: { bot?: { open_id?: string } };
  };
  const botOpenId = data.bot?.open_id ?? data.data?.bot?.open_id;
  if (!botOpenId) {
    throw new Error('Feishu bot info response did not include bot.open_id');
  }
  return { botOpenId };
}

function maskSensitiveFields(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveFields(item, parentKey));
  }
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) || isSensitiveKey(parentKey)
      ? maskCredential(child)
      : maskSensitiveFields(child, key);
  }
  return result;
}

export function registerAdminConfigRoutes(app: Hono, deps: AdminConfigDeps): void {
  app.post('/api/admin/verify-bot', async (c) => {
    const config = deps.configRef.current;
    const body = await c.req.json<{
      name?: string;
      channel?: string;
      credentials?: Record<string, string>;
    }>();
    const existing = body.name ? config.bots[body.name] : undefined;
    const channel = body.channel ?? existing?.channel;
    const credentials = mergeCredentials(existing?.credentials, body.credentials);

    try {
      if (channel === 'feishu') {
        const result = await verifyFeishuBot(credentials);
        return c.json({ ok: true, channel, ...result });
      }
      if (channel === 'web') {
        return c.json({ ok: true, channel });
      }
      if (channel === 'dingtalk') {
        return c.json({ ok: false, channel, error: 'DingTalk connection test is not implemented yet' });
      }
      return c.json({ ok: false, error: 'Bot channel is required' }, 400);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, channel, error: message });
    }
  });

  app.post('/api/admin/verify-model', async (c) => {
    const body = await c.req.json<{ baseUrl?: string; authToken?: string; model?: string }>();
    if (!body.baseUrl || !body.authToken) {
      return c.json({ ok: false, error: 'Base URL and Auth Token are required' }, 400);
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const payload = JSON.stringify({
        model: body.model || 'claude-sonnet-4-6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      const url = buildAnthropicMessagesUrl(body.baseUrl);
      let resp = await fetch(url, {
        method: 'POST',
        headers: buildModelVerifyHeaders(body.authToken, 'bearer'),
        body: payload,
        signal: controller.signal,
      });
      if (resp.status === 401 || resp.status === 403) {
        resp = await fetch(url, {
          method: 'POST',
          headers: buildModelVerifyHeaders(body.authToken, 'api-key'),
          body: payload,
          signal: controller.signal,
        });
      }
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json() as Record<string, unknown>;
        return c.json({ ok: true, model: data.model || body.model });
      }
      const errText = await resp.text().catch(() => '');
      return c.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg });
    }
  });

  app.get('/api/admin/config', (c) => {
    const config = deps.configRef.current;
    return c.json(maskSensitiveFields(config));
  });

  app.post('/api/admin/config/reveal', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(deps.configRef.current);
  });

  app.post('/api/admin/config', async (c) => {
    const config = deps.configRef.current;
    const body = await c.req.json<{
      apiKey?: string;
      baseUrl?: string;
      authToken?: string;
      model?: string;
      webChat?: Partial<Config['webChat']>;
      bots?: Array<{
        name: string;
        channel?: string;
        credentials?: Record<string, string>;
        displayName?: string;
        agentDir?: string;
        cwd?: string;
        model?: string;
        baseUrl?: string;
        authToken?: string;
        reactionEmoji?: string;
        tenant?: string;
        routingMode?: 'direct' | 'employee-director';
        groupReplyMode?: 'mention-only' | 'all';
      }>;
    }>();

    if (body.apiKey || body.baseUrl || body.authToken) {
      if (isUsableCredential(body.apiKey)) process.env.ANTHROPIC_API_KEY = body.apiKey;
      if (body.baseUrl) process.env.ANTHROPIC_BASE_URL = body.baseUrl;
      if (isUsableCredential(body.authToken)) process.env.ANTHROPIC_AUTH_TOKEN = body.authToken;
      config.claude = {
        ...config.claude,
        ...(isUsableCredential(body.apiKey) && { apiKey: body.apiKey }),
        ...(body.baseUrl && { baseUrl: body.baseUrl }),
        ...(isUsableCredential(body.authToken) && { authToken: body.authToken }),
      };
    }

    if (body.model) {
      if (!config.claude) config.claude = {};
      config.claude.model = body.model;
      for (const bot of Object.values(config.bots) as Record<string, unknown>[]) {
        delete (bot as Record<string, unknown>).model;
      }
    }

    if (body.webChat) {
      config.webChat = {
        ...config.webChat,
        ...body.webChat,
      };
    }

    if (body.bots) {
      const nextBots: Config['bots'] = {};
      for (const bot of body.bots) {
        const existing = config.bots[bot.name];
        const channel = (bot.channel as 'feishu' | 'dingtalk' | 'web') ?? existing?.channel ?? 'web';
        nextBots[bot.name] = {
          channel,
          credentials: mergeCredentials(existing?.credentials, bot.credentials),
          displayName: bot.displayName ?? existing?.displayName ?? bot.name,
          agentDir: bot.agentDir ?? existing?.agentDir ?? `./agents/${bot.name}`,
          cwd: bot.cwd ?? existing?.cwd,
          model: existing?.model ? (bot.model ?? existing.model) : undefined,
          baseUrl: bot.baseUrl ?? existing?.baseUrl,
          authToken: isUsableCredential(bot.authToken) ? bot.authToken : existing?.authToken,
          reactionEmoji: bot.reactionEmoji ?? existing?.reactionEmoji,
          tenant: bot.tenant ?? existing?.tenant,
          routingMode: bot.routingMode ?? existing?.routingMode,
          groupReplyMode: channel === 'web' ? undefined : (bot.groupReplyMode ?? existing?.groupReplyMode),
        };
      }
      config.bots = nextBots;
    }

    deps.configRef.current = config;
    saveConfig(deps.configPath, config, deps.keyPath);
    deps.bus.publish({ type: 'config_reloaded' });
    return c.json({ success: true });
  });

  // ── Setup API (no auth — first-run only, rate-limited) ──

  const setupAttempts = new Map<string, number>();
  const SETUP_RATE_LIMIT = 10;
  const SETUP_WINDOW_MS = 60_000;

  function isSetupRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = setupAttempts.get(ip);
    if (!entry || (now - entry) > SETUP_WINDOW_MS) {
      setupAttempts.set(ip, now);
      return false;
    }
    setupAttempts.set(ip, entry + 1);
    return entry + 1 > SETUP_RATE_LIMIT;
  }

  app.get('/api/setup/status', (c) => {
    const config = deps.configRef.current;
    const apiKeySet = !!config.claude?.apiKey && !isEnvVarUnset(config.claude.apiKey);
    const thirdPartySet = !!config.claude?.baseUrl && !!config.claude?.authToken;
    const hasModel = !!config.claude?.authToken || apiKeySet;

    // Check employee network readiness
    let employeeNetworkReady = false;
    if (deps.corpDir) {
      try {
        if (existsSync(deps.corpDir)) {
          for (const entry of readdirSync(deps.corpDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const employeesDir = join(deps.corpDir, entry.name, 'employees');
            if (existsSync(employeesDir)) {
              const files = readdirSync(employeesDir);
              if (files.some((f) => f.endsWith('.yaml'))) {
                employeeNetworkReady = true;
                break;
              }
            }
          }
        }
      } catch {
        employeeNetworkReady = false;
      }
    }

    // Check if people.json has any entryEmployee bindings
    let peopleBound = false;
    if (deps.corpDir && employeeNetworkReady) {
      try {
        if (existsSync(deps.corpDir)) {
          for (const entry of readdirSync(deps.corpDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const peopleJsonPath = join(deps.corpDir, entry.name, 'people.json');
            if (existsSync(peopleJsonPath)) {
              const people = JSON.parse(readFileSync(peopleJsonPath, 'utf-8')) as Array<{
                entryEmployee?: string;
              }>;
              if (people.some((p) => p.entryEmployee)) {
                peopleBound = true;
                break;
              }
            }
          }
        }
      } catch {
        peopleBound = false;
      }
    }

    const configured = hasModel && employeeNetworkReady && peopleBound;

    return c.json({
      configured,
      needsApiKey: !hasModel,
      steps: {
        modelConfigured: hasModel,
        employeeNetworkReady,
        peopleBound,
      },
    });
  });

  app.post('/api/setup/config', async (c) => {
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown';
    if (isSetupRateLimited(clientIp)) {
      return c.json({ error: 'Too many setup attempts, try again later' }, 429);
    }
    try {
      const config = deps.configRef.current;
      const alreadyConfigured = !!config.claude?.apiKey
        && !isEnvVarUnset(config.claude.apiKey)
        && Object.keys(config.bots).length > 0;
      if (alreadyConfigured && !c.req.header('X-Force-Setup')) {
        return c.json({ error: 'System already configured. Use admin API to modify configuration.' }, 403);
      }

      const body = await c.req.json<{
        apiKey?: string;
        baseUrl?: string;
        authToken?: string;
          model?: string;
          webChat?: Partial<Config['webChat']>;
          bots?: Array<{
          name: string;
          channel?: string;
          credentials?: Record<string, string>;
          displayName?: string;
          agentDir?: string;
          cwd?: string;
          model?: string;
          baseUrl?: string;
          authToken?: string;
          tenant?: string;
          routingMode?: 'direct' | 'employee-director';
          groupReplyMode?: 'mention-only' | 'all';
        }>;
      }>();

      if (body.apiKey || body.baseUrl || body.authToken) {
        if (isUsableCredential(body.apiKey)) process.env.ANTHROPIC_API_KEY = body.apiKey;
        if (body.baseUrl) process.env.ANTHROPIC_BASE_URL = body.baseUrl;
        if (isUsableCredential(body.authToken)) process.env.ANTHROPIC_AUTH_TOKEN = body.authToken;
        config.claude = {
          ...config.claude,
          ...(isUsableCredential(body.apiKey) && { apiKey: body.apiKey }),
          ...(body.baseUrl && { baseUrl: body.baseUrl }),
          ...(isUsableCredential(body.authToken) && { authToken: body.authToken }),
        };
      }

      if (body.model) {
        if (!config.claude) config.claude = {};
        config.claude.model = body.model;
        for (const bot of Object.values(config.bots)) {
          delete bot.model;
        }
      }

      if (body.webChat) {
        config.webChat = {
          ...config.webChat,
          ...body.webChat,
        };
      }

      if (body.bots) {
        for (const bot of body.bots) {
          const existing = config.bots[bot.name];
          const channel = (bot.channel as 'feishu' | 'dingtalk' | 'web') ?? existing?.channel ?? 'web';
          config.bots[bot.name] = {
            channel,
            credentials: mergeCredentials(existing?.credentials, bot.credentials),
            displayName: bot.displayName ?? existing?.displayName ?? bot.name,
            agentDir: bot.agentDir ?? existing?.agentDir ?? `./agents/${bot.name}`,
            cwd: bot.cwd ?? existing?.cwd,
            model: bot.model ?? existing?.model,
            baseUrl: bot.baseUrl ?? existing?.baseUrl,
            authToken: isUsableCredential(bot.authToken) ? bot.authToken : existing?.authToken,
            tenant: bot.tenant ?? existing?.tenant,
            routingMode: bot.routingMode ?? existing?.routingMode,
            groupReplyMode: channel === 'web' ? undefined : (bot.groupReplyMode ?? existing?.groupReplyMode),
          };
        }
      }

      deps.configRef.current = config;
      saveConfig(deps.configPath, config, deps.keyPath);
      deps.bus.publish({ type: 'config_reloaded' });
      return c.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });
}
