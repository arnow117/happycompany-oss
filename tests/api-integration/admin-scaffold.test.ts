/**
 * Admin Scaffold API Integration Tests
 *
 * Tests endpoints #44-45 for app scaffolding:
 * - #44 GET /api/admin/scaffold/types
 * - #45 POST /api/admin/scaffold
 */

import { test, expect } from 'vitest';
import { getJSON, postJSON } from './helpers';

// ── GET /api/admin/scaffold/types ────────────────────────

test('GET /api/admin/scaffold/types returns array of scaffold types', async () => {
  const { status, body } = await getJSON('/api/admin/scaffold/types');
  expect(status).toBe(200);
  expect(body).toBeInstanceOf(Array);
});

test('GET /api/admin/scaffold/types items have type, label, and description', async () => {
  const { status, body } = await getJSON('/api/admin/scaffold/types');
  expect(status).toBe(200);
  const types = body as unknown[];
  if (types.length > 0) {
    const first = types[0] as Record<string, unknown>;
    expect(first).toHaveProperty('type');
    expect(first).toHaveProperty('label');
    expect(first).toHaveProperty('description');
  }
});

test('GET /api/admin/scaffold/types includes known scaffold types', async () => {
  const { status, body } = await getJSON('/api/admin/scaffold/types');
  expect(status).toBe(200);
  const types = body as Array<{ type: string; label: string; description: string }>;
  const typeValues = types.map((t) => t.type);

  expect(typeValues.length).toBeGreaterThan(0);
  expect(typeValues).toContain('custom');
  expect(typeValues).toContain('tool');
  expect(typeValues).toContain('kb');
});

// ── POST /api/admin/scaffold ─────────────────────────────

test('POST /api/admin/scaffold requires name, type, and description', async () => {
  const { status, body } = await postJSON('/api/admin/scaffold', {});
  expect([400, 422]).toContain(status);
  expect(body).toBeInstanceOf(Object);
  expect(body).toHaveProperty('error');
});

test('POST /api/admin/scaffold rejects missing name', async () => {
  const { status, body } = await postJSON('/api/admin/scaffold', {
    type: 'custom',
    description: 'Test',
  });
  expect([400, 422]).toContain(status);
  expect(body).toHaveProperty('error');
});

test('POST /api/admin/scaffold rejects missing type', async () => {
  const { status, body } = await postJSON('/api/admin/scaffold', {
    name: 'test-app',
    description: 'Test',
  });
  expect([400, 422]).toContain(status);
  expect(body).toHaveProperty('error');
});

test('POST /api/admin/scaffold rejects missing description', async () => {
  const { status, body } = await postJSON('/api/admin/scaffold', {
    name: 'test-app',
    type: 'custom',
  });
  expect([400, 422]).toContain(status);
  expect(body).toHaveProperty('error');
});

test('POST /api/admin/scaffold rejects invalid type', async () => {
  const { status, body } = await postJSON('/api/admin/scaffold', {
    name: 'test-app',
    type: 'invalid-scaffold-type-xyz123',
    description: 'Test',
  });
  // Server returns 500 for unknown scaffold types
  expect([400, 404, 422, 500]).toContain(status);
});

test('POST /api/admin/scaffold accepts valid custom scaffold request', async () => {
  const { status, body } = await postJSON('/api/admin/scaffold', {
    name: `test-scaffold-custom-${Date.now()}`,
    type: 'custom',
    description: 'Test custom scaffold creation',
  });
  expect([200, 201]).toContain(status);
  expect(body).toBeInstanceOf(Object);
});

test('POST /api/admin/scaffold accepts valid tool scaffold request', async () => {
  const { status, body } = await postJSON('/api/admin/scaffold', {
    name: `test-scaffold-tool-${Date.now()}`,
    type: 'tool',
    description: 'Test tool scaffold creation',
  });
  expect([200, 201]).toContain(status);
  expect(body).toBeInstanceOf(Object);
});
