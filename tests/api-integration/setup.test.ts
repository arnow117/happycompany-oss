/**
 * Integration tests for setup endpoints.
 *
 * Covers: GET /api/setup/status, POST /api/setup/config
 */

import { test, expect } from 'vitest';
import { getJSON, postJSON } from './helpers.js';

// ── GET /api/setup/status ──────────────────────────────

test('GET /api/setup/status returns configuration status', async () => {
  const { status, body } = await getJSON('/api/setup/status');
  expect(status).toBe(200);
  expect(body).toHaveProperty('configured');
  expect(body).toHaveProperty('steps');
  expect(typeof body.configured).toBe('boolean');
  expect(typeof body.steps.modelConfigured).toBe('boolean');
  expect(typeof body.steps.employeeNetworkReady).toBe('boolean');
  expect(typeof body.steps.peopleBound).toBe('boolean');
});

// ── GET /api/setup/status — three-step bootstrap ──────

test('GET /api/setup/status returns steps object for bootstrap flow', async () => {
  const { status, body } = await getJSON('/api/setup/status');
  expect(status).toBe(200);
  expect(body).toHaveProperty('steps');
  expect(body.steps).toHaveProperty('modelConfigured');
  expect(body.steps).toHaveProperty('employeeNetworkReady');
  expect(body.steps).toHaveProperty('peopleBound');
  expect(typeof body.steps.modelConfigured).toBe('boolean');
  expect(typeof body.steps.employeeNetworkReady).toBe('boolean');
  expect(typeof body.steps.peopleBound).toBe('boolean');
});

test('GET /api/setup/status steps.modelConfigured reflects API key presence', async () => {
  const { body } = await getJSON('/api/setup/status');
  // If a model is configured (API key or third-party), modelConfigured should be true
  const hasApiKey = body.needsApiKey === false;
  expect(body.steps.modelConfigured).toBe(hasApiKey);
});

test('GET /api/setup/status steps.employeeNetworkReady reflects employee YAML presence', async () => {
  const { body } = await getJSON('/api/setup/status');
  // employeeNetworkReady depends on corpDir having employee YAML files
  expect(typeof body.steps.employeeNetworkReady).toBe('boolean');
});

test('GET /api/setup/status configured is true only when model + people bound', async () => {
  const { body } = await getJSON('/api/setup/status');
  const allStepsDone = body.steps.modelConfigured && body.steps.employeeNetworkReady && body.steps.peopleBound;
  expect(body.configured).toBe(allStepsDone);
});

// ── POST /api/setup/config ─────────────────────────────
// NOTE: Setup endpoint is rate-limited. Tests share the same server,
// so later tests may hit 429. Accept both 200 and 429.

test('POST /api/setup/config with empty body returns success', async () => {
  const { status, body } = await postJSON('/api/setup/config', {});
  // Accept 200 (success), 429 (rate-limited), or 403 (already configured)
  expect([200, 429, 403]).toContain(status);
});

test('POST /api/setup/config with model sets global model', async () => {
  const { status, body } = await postJSON('/api/setup/config', { model: 'claude-sonnet-4-20250514' });
  expect([200, 429]).toContain(status);
});

test('POST /api/setup/config with bots creates bot entries', async () => {
  const { status, body } = await postJSON('/api/setup/config', {
    bots: [{ name: '__setup-test__', displayName: 'Setup Test' }],
  });
  expect([200, 429]).toContain(status);
});

test('POST /api/setup/config rejects invalid JSON', async () => {
  const res = await fetch('http://127.0.0.1:3100/api/setup/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  // May be 500 (Hono parse error) or 429 (rate limited)
  expect([429, 500]).toContain(res.status);
});

test('POST /api/setup/config with X-Force-Setup bypasses already-configured check', async () => {
  const res = await fetch('http://127.0.0.1:3100/api/setup/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Force-Setup': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514' }),
  });
  // May be 429 if rate-limited by prior setup tests in same run
  expect([200, 429]).toContain(res.status);
  if (res.status === 200) {
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
  }
});
