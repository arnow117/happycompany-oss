/**
 * Integration tests for public API endpoints.
 *
 * Covers: /api/bots, /api/workdirs, /api/workdir/:id/sessions,
 *        /api/chats, /api/chats/:chatId/messages, /api/chat/:botName/history,
 *        /api/chats/:botName
 */

import { test, expect } from 'vitest';
import { getJSON, BASE } from './helpers.js';

// ── GET /api/bots ──────────────────────────────────────

test('GET /api/bots returns array of bot infos', async () => {
  const { status, body } = await getJSON('/api/bots');
  expect(status).toBe(200);
  expect(body).toBeInstanceOf(Array);
});

test('GET /api/bots each bot has required fields', async () => {
  const { status, body } = await getJSON('/api/bots');
  expect(status).toBe(200);
  for (const bot of body as Array<Record<string, unknown>>) {
    expect(bot).toHaveProperty('name');
    expect(typeof bot.name).toBe('string');
  }
});

// ── GET /api/workdirs ──────────────────────────────────

test('GET /api/workdirs returns array', async () => {
  const { status, body } = await getJSON('/api/workdirs');
  expect(status).toBe(200);
  expect(body).toBeInstanceOf(Array);
});

test('GET /api/workdirs items have id, displayName, path, channels, status', async () => {
  const { status, body } = await getJSON('/api/workdirs');
  expect(status).toBe(200);
  for (const wd of body as Array<Record<string, unknown>>) {
    expect(wd).toHaveProperty('id');
    expect(wd).toHaveProperty('displayName');
    expect(wd).toHaveProperty('path');
    expect(wd).toHaveProperty('channels');
    expect(wd).toHaveProperty('status');
  }
});

// ── GET /api/workdir/:id/sessions ──────────────────────

test('GET /api/workdir/:id/sessions returns sessions object', async () => {
  const { status, body } = await getJSON('/api/workdir/web/sessions');
  expect(status).toBe(200);
  expect(body).toHaveProperty('sessions');
  expect(body.sessions).toBeInstanceOf(Array);
});

test('GET /api/workdir/nonexistent/sessions returns 200 or 500', async () => {
  const { status } = await getJSON('/api/workdir/nonexistent/sessions');
  expect([200, 500]).toContain(status);
});

// ── GET /api/chats ─────────────────────────────────────

test('GET /api/chats returns array', async () => {
  const { status, body } = await getJSON('/api/chats');
  expect(status).toBe(200);
  expect(body).toBeInstanceOf(Array);
});

// ── GET /api/chats/:chatId/messages ─────────────────────

test('GET /api/chats/:chatId/messages returns messages array', async () => {
  const { status, body } = await getJSON('/api/chats/test-chat-id/messages');
  expect(status).toBe(200);
  expect(body).toBeInstanceOf(Array);
});

// ── GET /api/chat/:botName/history ─────────────────────

test('GET /api/chat/:botName/history returns data array', async () => {
  const { status, body } = await getJSON('/api/chat/web/history');
  expect(status).toBe(200);
  expect(body).toHaveProperty('data');
  expect(body.data).toBeInstanceOf(Array);
});

test('GET /api/chat/:botName/history respects limit param', async () => {
  const { status, body } = await getJSON('/api/chat/web/history?limit=5');
  expect(status).toBe(200);
  expect(body).toHaveProperty('data');
  expect((body.data as unknown[]).length).toBeLessThanOrEqual(5);
});

// ── GET /api/chats/:botName ────────────────────────────

test('GET /api/chats/:botName returns data array', async () => {
  const { status, body } = await getJSON('/api/chats/web');
  expect(status).toBe(200);
  expect(body).toHaveProperty('data');
  expect(body.data).toBeInstanceOf(Array);
});

// ── POST /api/setup/config (rate-limited first-run setup) ────

test('POST /api/setup/config accepts config payload', async () => {
  const res = await fetch(`${BASE}/api/setup/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'test-model',
      apiKey: 'sk-test',
      botName: 'test-bot',
    }),
  });
  // May be rate-limited or forbidden when the shared integration server is already configured.
  expect([200, 429, 403]).toContain(res.status);
  if (res.status === 200) {
    const body = await res.json();
    expect(body).toHaveProperty('success');
  }
});
test('GET /api/setup/status returns configured flag', async () => {
  const { status, body } = await getJSON('/api/setup/status');
  expect(status).toBe(200);
  expect(body).toHaveProperty('configured');
  expect(typeof body.configured).toBe('boolean');
});

// ── GET /api/workdir/:id/sessions (nonexistent case fix) ───

test('GET /api/workdir/nonexistent/sessions returns 404 or 200 with empty', async () => {
  const { status } = await getJSON('/api/workdir/nonexistent/sessions');
  expect([200, 404]).toContain(status);
});
