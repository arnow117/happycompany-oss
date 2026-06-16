/**
 * Full-stack integration test.
 *
 * Makes real HTTP requests to the Hono server managed by Vitest globalSetup.
 *
 * Run:  npx vitest run tests/server-integration.test.ts
 */

import { test, expect } from 'vitest';

const BASE = `http://127.0.0.1`;
const PORT = 3100;

// -- API endpoints --

test('GET /api/health returns status ok', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/health`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.status).toBe('ok');
  expect(body.bots).toBeInstanceOf(Array);
});

test('GET /api/admin/config returns config with claude key', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/admin/config`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toHaveProperty('claude');
  expect(typeof (body.claude as Record<string, unknown>)?.model).toBe('string');
});

test('GET /api/admin/config returns bots object', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/admin/config`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toHaveProperty('bots');
  expect(body.bots).toBeInstanceOf(Object);
});

test('GET /api/admin/skills returns array', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/admin/skills`);
  expect(res.ok).toBe(true);
  expect(await res.json()).toBeInstanceOf(Array);
});

test('GET /api/business/agents returns agents list', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/business/agents`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toHaveProperty('agents');
});

test('GET /api/business/channels returns channels list', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/business/channels`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toHaveProperty('channels');
});

test('GET /api/business/contract-chain returns combined view', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/business/contract-chain`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toHaveProperty('agents');
  expect(body).toHaveProperty('channels');
});

test('GET /api/admin/scheduler/tasks returns array', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/admin/scheduler/tasks`);
  expect(res.ok).toBe(true);
  expect(await res.json()).toBeInstanceOf(Array);
});

// -- SPA static serving --

test('GET / returns HTML (SPA entry)', async () => {
  const res = await fetch(`${BASE}:${PORT}/`);
  expect(res.ok).toBe(true);
  expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/html');
  const html = await res.text();
  expect(html).toContain('<div id="root">');
  expect(html).toContain('manifest.json');
});

test('GET /config returns HTML (SPA client route)', async () => {
  const res = await fetch(`${BASE}:${PORT}/config`);
  expect(res.ok).toBe(true);
  expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/html');
});

test('GET /chat returns HTML (SPA client route)', async () => {
  const res = await fetch(`${BASE}:${PORT}/chat`);
  expect(res.ok).toBe(true);
  expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/html');
});

test('GET /sessions returns HTML (SPA client route)', async () => {
  const res = await fetch(`${BASE}:${PORT}/sessions`);
  expect(res.ok).toBe(true);
  expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/html');
});

// -- PWA assets --

test('GET /manifest.json returns valid manifest', async () => {
  const res = await fetch(`${BASE}:${PORT}/manifest.json`);
  expect(res.ok).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBeTruthy();
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');
});

test('GET /sw.js returns service worker script', async () => {
  const res = await fetch(`${BASE}:${PORT}/sw.js`);
  expect(res.ok).toBe(true);
  const sw = await res.text();
  expect(sw).toContain('CACHE_NAME');
});

test('GET /assets/*.css returns CSS content type', async () => {
  const html = await (await fetch(`${BASE}:${PORT}/`)).text();
  const cssMatch = html.match(/\/assets\/[^"]+\.css/);
  if (!cssMatch) return;
  const cssRes = await fetch(`${BASE}:${PORT}${cssMatch[0]}`);
  expect(cssRes.ok).toBe(true);
  expect(cssRes.headers.get('content-type')?.toLowerCase()).toContain('text/css');
});

test('GET /assets/*.js returns JS content type', async () => {
  const html = await (await fetch(`${BASE}:${PORT}/`)).text();
  const jsMatch = html.match(/\/assets\/[^"]+\.js/);
  if (!jsMatch) return;
  const jsRes = await fetch(`${BASE}:${PORT}${jsMatch[0]}`);
  expect(jsRes.ok).toBe(true);
  expect(jsRes.headers.get('content-type')?.toLowerCase()).toContain('javascript');
});

// -- Security / edge cases --

test('GET /api/nonexistent returns 404', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/nonexistent`);
  expect(res.status).toBe(404);
});

test('GET /nonexistent.html returns SPA fallback HTML', async () => {
  const res = await fetch(`${BASE}:${PORT}/nonexistent.html`);
  expect(res.ok).toBe(true);
  expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/html');
  const html = await res.text();
  expect(html).toContain('<div id="root">');
});

test('API responses have CORS headers', async () => {
  const res = await fetch(`${BASE}:${PORT}/api/health`);
  expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
});

test('HTML includes PWA meta tags', async () => {
  const html = await (await fetch(`${BASE}:${PORT}/`)).text();
  expect(html).toContain('manifest.json');
  expect(html).toContain('theme-color');
  expect(html).toContain('apple-mobile-web-app-capable');
});
