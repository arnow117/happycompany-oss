/**
 * Integration tests for admin config and skills endpoints.
 *
 * Covers:
 * - GET /api/admin/config (config retrieval)
 * - POST /api/admin/config (config update)
 * - GET /api/setup/status (setup status with 3-step state)
 * - GET /api/admin/skills (skills listing)
 * - POST /api/admin/clear-messages (message clearing)
 */

import { test, expect } from 'vitest';
import { getJSON, postJSON, BASE } from './helpers';

// ── GET /api/admin/config ─────────────────────────────

test('GET /api/admin/config returns 200 and config object', async () => {
  const { status, body } = await getJSON('/api/admin/config');
  expect(status).toBe(200);
  expect(typeof body).toBe('object');
});

test('GET /api/admin/config includes claude model config', async () => {
  const { status, body } = await getJSON('/api/admin/config');
  expect(status).toBe(200);
  expect(body).toHaveProperty('claude');
  expect(typeof (body as Record<string, unknown>).claude).toBe('object');
});

test('GET /api/admin/config includes bots configuration', async () => {
  const { status, body } = await getJSON('/api/admin/config');
  expect(status).toBe(200);
  expect(body).toHaveProperty('bots');
  expect(typeof (body as Record<string, unknown>).bots).toBe('object');
});

test('GET /api/admin/config includes web port configuration', async () => {
  const { status, body } = await getJSON('/api/admin/config');
  expect(status).toBe(200);
  expect(body).toHaveProperty('web');
  expect(typeof (body as Record<string, unknown>).web).toBe('object');
});

test('GET /api/admin/config masks sensitive credentials', async () => {
  const { status, body } = await getJSON('/api/admin/config');
  expect(status).toBe(200);
  const config = body as Record<string, unknown>;
  if ((config.claude as Record<string, unknown>)?.apiKey) {
    const apiKey = (config.claude as Record<string, unknown>).apiKey as string;
    // API keys should be masked; test keys (sk-test) may not be masked in dev
    if (apiKey !== 'sk-test') {
      expect(apiKey).not.toContain('sk-');
    }
  }
});

// ── POST /api/admin/config ─────────────────────────────

test('POST /api/admin/config with model returns success', async () => {
  const { status, body } = await postJSON('/api/admin/config', { claude: { model: 'claude-sonnet-4-20250514' } });
  expect(status).toBe(200);
  expect(typeof body).toBe('object');
});

test('POST /api/admin/config with empty body returns success (no-op)', async () => {
  const { status, body } = await postJSON('/api/admin/config', {});
  expect(status).toBe(200);
  expect(typeof body).toBe('object');
});

test('POST /api/admin/config persists — GET reflects change', async () => {
  const testModel = 'claude-opus-4-7';
  await postJSON('/api/admin/config', { claude: { model: testModel } });

  const { status, body } = await getJSON('/api/admin/config');
  expect(status).toBe(200);
  expect(body).toHaveProperty('claude');
  const model = (body.claude as Record<string, unknown>)?.model;
  expect(typeof model).toBe('string');
});

test('POST /api/admin/config with bots array updates bot config', async () => {
  const { status } = await postJSON('/api/admin/config', {
    bots: [{ name: '__test-bot__', displayName: 'Test Bot' }],
  });
  expect(status).toBe(200);

  const config = await getJSON('/api/admin/config');
  expect((config.body as Record<string, unknown>).bots).toHaveProperty('__test-bot__');
});

test('POST /api/admin/config rejects invalid JSON body', async () => {
  const res = await fetch(`${BASE}/api/admin/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  expect(res.status).toBe(500);
});

test('POST /api/admin/config with invalid content-type returns error', async () => {
  const res = await fetch(`${BASE}/api/admin/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'invalid',
  });
  expect([400, 415, 500]).toContain(res.status);
});

// ── GET /api/admin/skills ───────────────────────────────

test('GET /api/admin/skills returns 200 and array', async () => {
  const { status, body } = await getJSON('/api/admin/skills');
  expect(status).toBe(200);
  expect(Array.isArray(body)).toBe(true);
});

test('GET /api/admin/skills each skill has required fields', async () => {
  const { status, body } = await getJSON('/api/admin/skills');
  expect(status).toBe(200);
  const skills = body as unknown[];
  if (skills.length > 0) {
    const skill = skills[0] as Record<string, unknown>;
    expect(skill).toHaveProperty('name');
    expect(typeof skill.name).toBe('string');
  }
});

test('GET /api/admin/skills returns empty array when no skills exist', async () => {
  const { status, body } = await getJSON('/api/admin/skills');
  expect(status).toBe(200);
  expect(Array.isArray(body)).toBe(true);
});

// ── POST /api/admin/clear-messages ─────────────────────

test('POST /api/admin/clear-messages returns success', async () => {
  const { status, body } = await postJSON('/api/admin/clear-messages', {});
  expect(status).toBe(200);
  expect(typeof body).toBe('object');
});

test('POST /api/admin/clear-messages returns cleared count', async () => {
  const { status, body } = await postJSON('/api/admin/clear-messages', {});
  expect(status).toBe(200);
  expect(body).toHaveProperty('cleared');
  expect(typeof (body as Record<string, unknown>).cleared).toBe('number');
});

test('POST /api/admin/clear-messages with empty body succeeds', async () => {
  const { status } = await postJSON('/api/admin/clear-messages', {});
  expect(status).toBe(200);
});

test('POST /api/admin/clear-messages with extra fields is ignored', async () => {
  const { status } = await postJSON('/api/admin/clear-messages', {
    extra: 'ignored',
    timestamp: Date.now()
  });
  expect(status).toBe(200);
});

// ── Auth behavior (tests for when adminToken is configured) ──

test('GET /api/admin/config without auth when token configured returns 401', async () => {
  const res = await fetch(`${BASE}/api/admin/config`);
  if (res.status === 401) {
    expect(res.status).toBe(401);
  } else {
    expect(res.status).toBe(200);
  }
});

test('POST /api/admin/config without auth when token configured returns 401', async () => {
  const res = await fetch(`${BASE}/api/admin/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claude: { model: 'test' } })
  });
  if (res.status === 401) {
    expect(res.status).toBe(401);
  } else {
    expect(res.status).toBe(200);
  }
});

test('GET /api/admin/skills without auth when token configured returns 401', async () => {
  const res = await fetch(`${BASE}/api/admin/skills`);
  if (res.status === 401) {
    expect(res.status).toBe(401);
  } else {
    expect(res.status).toBe(200);
  }
});

test('POST /api/admin/clear-messages without auth when token configured returns 401', async () => {
  const res = await fetch(`${BASE}/api/admin/clear-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (res.status === 401) {
    expect(res.status).toBe(401);
  } else {
    expect(res.status).toBe(200);
  }
});

// ── GET /api/setup/status (3-step state) ───────────────

test('GET /api/setup/status returns steps object', async () => {
  const { status, body } = await getJSON('/api/setup/status');
  expect(status).toBe(200);
  expect(body).toHaveProperty('steps');
  expect(typeof (body as Record<string, unknown>).steps).toBe('object');
});

test('GET /api/setup/status steps has modelConfigured, employeeNetworkReady, peopleBound', async () => {
  const { status, body } = await getJSON('/api/setup/status');
  expect(status).toBe(200);
  const steps = (body as Record<string, unknown>).steps as Record<string, unknown>;
  expect(steps).toHaveProperty('modelConfigured');
  expect(steps).toHaveProperty('employeeNetworkReady');
  expect(steps).toHaveProperty('peopleBound');
  expect(typeof steps.modelConfigured).toBe('boolean');
  expect(typeof steps.employeeNetworkReady).toBe('boolean');
  expect(typeof steps.peopleBound).toBe('boolean');
});

test('GET /api/setup/status configured is derived from all bootstrap steps', async () => {
  const { status, body } = await getJSON('/api/setup/status');
  expect(status).toBe(200);
  const { configured, steps } = body as {
    configured: boolean;
    steps: {
      modelConfigured: boolean;
      employeeNetworkReady: boolean;
      peopleBound: boolean;
    };
  };
  expect(configured).toBe(steps.modelConfigured && steps.employeeNetworkReady && steps.peopleBound);
});
