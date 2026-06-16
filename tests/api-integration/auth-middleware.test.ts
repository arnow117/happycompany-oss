/**
 * Integration tests for auth middleware behavior.
 *
 * Current behavior: when adminToken is NOT set in config.json,
 * all admin routes are open (no auth check). This test verifies:
 * 1. Admin routes are accessible without auth (dev default)
 * 2. Auth header is ignored when adminToken is not configured
 * 3. Public routes never require auth
 */

import { test, expect } from 'vitest';
import { getJSON } from './helpers.js';

// ── Dev mode: no auth required ────────────────────────

test('GET /api/admin/config succeeds without auth header (dev default)', async () => {
  const res = await fetch('http://127.0.0.1:3100/api/admin/config', {
    headers: {},
  });
  expect(res.ok).toBe(true);
  expect(res.status).toBe(200);
});

test('GET /api/admin/skills succeeds without auth header', async () => {
  const { status } = await getJSON('/api/admin/skills');
  expect(status).toBe(200);
});

test('GET /api/admin/analytics/usage succeeds without auth header', async () => {
  const { status } = await getJSON('/api/admin/analytics/usage?days=7');
  expect(status).toBe(200);
});

test('Invalid auth token is ignored when adminToken not configured', async () => {
  const res = await fetch('http://127.0.0.1:3100/api/admin/config', {
    headers: { 'Authorization': 'Bearer invalid-token-12345' },
  });
  expect(res.ok).toBe(true);
  expect(res.status).toBe(200);
});

// ── Public routes never require auth ───────────────────

test('GET /api/health never requires auth', async () => {
  const { status } = await getJSON('/api/health');
  expect(status).toBe(200);
});

test('GET /api/bots never requires auth', async () => {
  const { status } = await getJSON('/api/bots');
  expect(status).toBe(200);
});

test('GET /api/setup/status never requires auth', async () => {
  const { status } = await getJSON('/api/setup/status');
  expect(status).toBe(200);
});

test('GET /api/business/agents never requires auth', async () => {
  const { status } = await getJSON('/api/business/agents');
  expect(status).toBe(200);
});
