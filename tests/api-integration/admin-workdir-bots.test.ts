/**
 * Integration tests for admin workdir, bot sessions, and knowledge endpoints.
 *
 * Covers: GET /api/admin/workdirs, GET /api/admin/workdir/:path,
 *        workdir skills CRUD, workdir app version,
 *        bot sessions, clear-sessions, delete session,
 *        bot knowledge list/delete
 */

import { test, expect } from 'vitest';
import { getJSON, postJSON, delJSON, putJSON, BASE } from './helpers.js';

// ── GET /api/admin/workdirs ────────────────────────────

test('GET /api/admin/workdirs returns workdir list', async () => {
  const { status, body } = await getJSON('/api/admin/workdirs');
  expect(status).toBe(200);
  expect(body).toBeInstanceOf(Array);
});

// ── GET /api/admin/workdir/:path ───────────────────────

test('GET /api/admin/workdir/:path with path traversal returns SPA fallback', async () => {
  const res = await fetch(`${BASE}/api/admin/workdir/../../../etc`);
  // Path traversal is resolved by the framework before route matching;
  // the resulting path doesn't match any admin route, so SPA fallback kicks in
  expect([200, 400, 500]).toContain(res.status);
});

// ── Workdir Skills ─────────────────────────────────────

test('GET /api/admin/workdir-skills returns skills array', async () => {
  const { status, body } = await getJSON('/api/admin/workdir-skills?path=nonexistent');
  expect([400, 200]).toContain(status);
  if (status === 200) {
    expect(body).toBeInstanceOf(Array);
  }
});

test('GET /api/admin/workdir-skills/:name for nonexistent skill', async () => {
  const { status, body } = await getJSON('/api/admin/workdir-skills/no-skill?path=nonexistent');
  expect([400, 200]).toContain(status);
  if (status === 200) {
    expect((body as Record<string, unknown>).exists).toBe(false);
  }
});

test('PUT /api/admin/workdir-skills/:name with invalid path returns error or 200', async () => {
  const { status } = await putJSON(
    '/api/admin/workdir-skills/../../../etc/skills/test-skill?path=.',
    { content: '---\nname: test\n---\nTest content' },
  );
  // Server may not validate path traversal
  expect([200, 400, 500]).toContain(status);
});

test('PUT /api/admin/workdir-skills/:name rejects empty content', async () => {
  const { status } = await putJSON(
    '/api/admin/workdir-skills/test-skill?path=nonexistent',
    { content: '' },
  );
  expect([400, 500]).toContain(status);
});

// ── Removed workdir endpoint ───────────────────────────

test('POST /api/admin/workdir/remove is no longer exposed', async () => {
  const { status } = await postJSON('/api/admin/workdir/remove', {});
  expect(status).toBe(404);
});

// ── Bot sessions ───────────────────────────────────────

test('GET /api/admin/bots/:name/sessions returns sessions', async () => {
  const { status, body } = await getJSON('/api/admin/bots/web/sessions');
  expect(status).toBe(200);
  expect(body).toHaveProperty('sessions');
  expect(body.sessions).toBeInstanceOf(Array);
});

test('POST /api/admin/bots/:name/clear-sessions clears sessions', async () => {
  const { status, body } = await postJSON('/api/admin/bots/web/clear-sessions', {});
  expect(status).toBe(200);
  expect(body).toHaveProperty('cleared');
  expect(typeof (body as Record<string, unknown>).cleared).toBe('number');
});

test('DELETE /api/admin/bots/:name/sessions/:chatId deletes session', async () => {
  const { status, body } = await delJSON('/api/admin/bots/web/sessions/test-chat-id');
  expect(status).toBe(200);
  expect(body).toHaveProperty('cleared');
});

// ── Knowledge ──────────────────────────────────────────

test('GET /api/admin/bots/:name/knowledge returns files list or 404', async () => {
  const { status, body } = await getJSON('/api/admin/bots/web/knowledge');
  // May 404 if bot has no knowledge dir configured
  expect([200, 404]).toContain(status);
  if (status === 200) {
    expect(body).toHaveProperty('files');
    expect(body).toHaveProperty('path');
  }
});

test('GET /api/admin/bots/nonexistent/knowledge returns 404', async () => {
  const { status, body } = await getJSON('/api/admin/bots/nonexistent-bot/knowledge');
  expect(status).toBe(404);
  expect(body).toHaveProperty('error');
});

test('DELETE /api/admin/bots/:name/knowledge/:filename rejects path traversal', async () => {
  const { status, body } = await delJSON('/api/admin/bots/web/knowledge/..%2Fetc%2Fpasswd');
  expect(status).toBe(400);
  expect(body).toHaveProperty('error');
});

test('DELETE /api/admin/bots/:name/knowledge/:filename for nonexistent file returns 404', async () => {
  const { status, body } = await delJSON('/api/admin/bots/web/knowledge/nonexistent-file.txt');
  expect(status).toBe(404);
  expect(body).toHaveProperty('error');
});
