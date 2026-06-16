import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config.js';
import { MessageBus } from '../../src/bus.js';
import { registerAdminConfigRoutes } from '../../src/routes/admin-config.js';

function makeConfig(): Config {
  return {
    bots: {
      'my-bot': {
        channel: 'dingtalk',
        credentials: {
          clientId: 'old-client',
          clientSecret: 'old-secret',
        },
        displayName: 'My Bot',
        agentDir: 'agents/my-bot',
        authToken: 'old-bot-token',
      },
    },
    claude: {
      apiKey: 'old-api-key',
      baseUrl: 'https://old.example.com',
      authToken: 'old-auth-token',
      model: 'sonnet',
    },
    web: { port: 3100 },
    dataDir: 'data',
  };
}

describe('admin config routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('masks sensitive values in config responses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-config-route-'));
    try {
      const app = new Hono();
      registerAdminConfigRoutes(app, {
        bus: new MessageBus(),
        configRef: { current: makeConfig() },
        configPath: join(dir, 'config.json'),
        keyPath: join(dir, 'encryption.key'),
      });

      const res = await app.request('/api/admin/config');

      expect(res.status).toBe(200);
      const body = await res.json() as {
        claude: { apiKey: string; authToken: string };
        bots: Record<string, { credentials: Record<string, string>; authToken: string }>;
      };
      expect(body.claude.apiKey).toBe('*'.repeat('old-api-key'.length));
      expect(body.claude.authToken).toBe('*'.repeat('old-auth-token'.length));
      expect(body.bots['my-bot']!.credentials.clientId).toBe('old-client');
      expect(body.bots['my-bot']!.credentials.clientSecret).toBe('*'.repeat('old-secret'.length));
      expect(body.bots['my-bot']!.authToken).toBe('*'.repeat('old-bot-token'.length));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves existing secrets when admin config posts masked placeholders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-config-route-'));
    try {
      const configRef = { current: makeConfig() };
      const app = new Hono();
      registerAdminConfigRoutes(app, {
        bus: new MessageBus(),
        configRef,
        configPath: join(dir, 'config.json'),
        keyPath: join(dir, 'encryption.key'),
      });

      const res = await app.request('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: '*'.repeat('old-api-key'.length),
          baseUrl: 'https://new.example.com',
          authToken: '*'.repeat('old-auth-token'.length),
          bots: [{
            name: 'my-bot',
            channel: 'dingtalk',
            credentials: {
              clientId: 'new-client',
              clientSecret: '*'.repeat('old-secret'.length),
            },
            displayName: 'Renamed Bot',
            agentDir: 'agents/my-bot',
            authToken: '*'.repeat('old-bot-token'.length),
          }],
        }),
      });

      expect(res.status).toBe(200);
      expect(configRef.current.claude?.apiKey).toBe('old-api-key');
      expect(configRef.current.claude?.authToken).toBe('old-auth-token');
      expect(configRef.current.claude?.baseUrl).toBe('https://new.example.com');
      expect(configRef.current.bots['my-bot']!.credentials).toEqual({
        clientId: 'new-client',
        clientSecret: 'old-secret',
      });
      expect(configRef.current.bots['my-bot']!.authToken).toBe('old-bot-token');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replaces the bot list when admin config posts bots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-config-route-'));
    try {
      const configRef = { current: makeConfig() };
      configRef.current.bots['test-bot'] = {
        channel: 'feishu',
        credentials: { appId: 'old-app', appSecret: 'old-secret' },
        displayName: 'Test Bot',
        agentDir: 'agents/test-bot',
      };
      const app = new Hono();
      registerAdminConfigRoutes(app, {
        bus: new MessageBus(),
        configRef,
        configPath: join(dir, 'config.json'),
        keyPath: join(dir, 'encryption.key'),
      });

      const res = await app.request('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bots: [{
            name: 'my-bot',
            channel: 'dingtalk',
            displayName: 'Only Bot',
            agentDir: 'agents/my-bot',
            groupReplyMode: 'all',
          }],
        }),
      });

      expect(res.status).toBe(200);
      expect(Object.keys(configRef.current.bots)).toEqual(['my-bot']);
      expect(configRef.current.bots['my-bot']!.credentials).toEqual({
        clientId: 'old-client',
        clientSecret: 'old-secret',
      });
      expect(configRef.current.bots['my-bot']!.displayName).toBe('Only Bot');
      expect(configRef.current.bots['my-bot']!.groupReplyMode).toBe('all');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('saves web chat config without applying IM group reply mode to web bots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-config-route-'));
    try {
      const configRef = { current: makeConfig() };
      const app = new Hono();
      registerAdminConfigRoutes(app, {
        bus: new MessageBus(),
        configRef,
        configPath: join(dir, 'config.json'),
        keyPath: join(dir, 'encryption.key'),
      });

      const res = await app.request('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webChat: {
            inputPlaceholder: '问问公司助手',
            historyLimit: 80,
            enableImageUpload: false,
          },
          bots: [
            {
              name: 'web-bot',
              channel: 'web',
              displayName: 'Assistant',
              agentDir: 'agents/web-bot',
              groupReplyMode: 'all',
            },
            {
              name: 'my-bot',
              channel: 'dingtalk',
              displayName: 'IM Bot',
              agentDir: 'agents/my-bot',
              groupReplyMode: 'all',
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      expect(configRef.current.webChat.inputPlaceholder).toBe('问问公司助手');
      expect(configRef.current.webChat.historyLimit).toBe(80);
      expect(configRef.current.webChat.enableImageUpload).toBe(false);
      expect(configRef.current.bots['web-bot']!.groupReplyMode).toBeUndefined();
      expect(configRef.current.bots['my-bot']!.groupReplyMode).toBe('all');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates Feishu credentials before testing bot connectivity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-config-route-'));
    try {
      const app = new Hono();
      registerAdminConfigRoutes(app, {
        bus: new MessageBus(),
        configRef: { current: makeConfig() },
        configPath: join(dir, 'config.json'),
        keyPath: join(dir, 'encryption.key'),
      });

      const res = await app.request('/api/admin/verify-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'feishu',
          credentials: { appId: 'cli_test' },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; error?: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Feishu App Secret is required');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifies third-party model connections with bearer auth and normalized messages URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-config-route-'));
    try {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'GLM-5.1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      vi.stubGlobal('fetch', fetchMock);
      const app = new Hono();
      registerAdminConfigRoutes(app, {
        bus: new MessageBus(),
        configRef: { current: makeConfig() },
        configPath: join(dir, 'config.json'),
        keyPath: join(dir, 'encryption.key'),
      });

      const res = await app.request('/api/admin/verify-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'https://relay.example.com/v1',
          authToken: 'relay-token',
          model: 'GLM-5.1',
        }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, model: 'GLM-5.1' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://relay.example.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer relay-token',
            'anthropic-version': '2023-06-01',
          }),
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to x-api-key auth for Anthropic-compatible gateways that reject bearer auth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-config-route-'));
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ model: 'sonnet' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      vi.stubGlobal('fetch', fetchMock);
      const app = new Hono();
      registerAdminConfigRoutes(app, {
        bus: new MessageBus(),
        configRef: { current: makeConfig() },
        configPath: join(dir, 'config.json'),
        keyPath: join(dir, 'encryption.key'),
      });

      const res = await app.request('/api/admin/verify-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'https://relay.example.com',
          authToken: 'api-key-token',
          model: 'sonnet',
        }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, model: 'sonnet' });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://relay.example.com/v1/messages',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-api-key': 'api-key-token' }),
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reveals unmasked config through the explicit admin reveal endpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'admin-config-route-'));
    try {
      const app = new Hono();
      registerAdminConfigRoutes(app, {
        bus: new MessageBus(),
        configRef: { current: makeConfig() },
        configPath: join(dir, 'config.json'),
        keyPath: join(dir, 'encryption.key'),
      });

      const res = await app.request('/api/admin/config/reveal', { method: 'POST' });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const body = await res.json() as {
        claude: { authToken: string };
        bots: Record<string, { credentials: Record<string, string>; authToken: string }>;
      };
      expect(body.claude.authToken).toBe('old-auth-token');
      expect(body.bots['my-bot']!.credentials.clientSecret).toBe('old-secret');
      expect(body.bots['my-bot']!.authToken).toBe('old-bot-token');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
