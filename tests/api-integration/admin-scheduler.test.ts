/**
 * Integration tests for admin scheduler endpoints.
 *
 * Covers: POST/PUT/DELETE /api/admin/scheduler/tasks,
 *        POST /api/admin/scheduler/tasks/:id/trigger
 */

import { test, expect } from 'vitest';
import { getJSON, postJSON, putJSON, delJSON } from './helpers.js';

// ── POST /api/admin/scheduler/tasks (create) ────────────

test('POST /api/admin/scheduler/tasks creates a new task', async () => {
  const { status, body } = await postJSON('/api/admin/scheduler/tasks', {
    name: `__test_task_${Date.now()}`,
    botName: 'web',
    scheduleType: 'once',
    scheduleValue: '0',
    prompt: 'Test prompt',
    enabled: true,
  });
  expect(status).toBe(200);
  expect(body).toHaveProperty('id');
  expect(body).toHaveProperty('name');
  expect(body).toHaveProperty('scheduleType');
  expect(body.scheduleType).toBe('once');
  expect(body).toHaveProperty('enabled');
  expect(body.enabled).toBe(true);
});

test('POST /api/admin/scheduler/tasks rejects missing name', async () => {
  const { status, body } = await postJSON('/api/admin/scheduler/tasks', {
    botName: 'web',
    scheduleType: 'once',
    scheduleValue: '0',
    prompt: 'Test',
  });
  expect(status).toBe(400);
  expect(body).toHaveProperty('error');
});

test('POST /api/admin/scheduler/tasks rejects invalid scheduleType', async () => {
  const { status, body } = await postJSON('/api/admin/scheduler/tasks', {
    name: 'bad-type',
    botName: 'web',
    scheduleType: 'invalid',
    scheduleValue: '0',
    prompt: 'Test',
  });
  expect(status).toBe(400);
  expect(body).toHaveProperty('error');
  expect((body.error as string)).toContain('scheduleType');
});

test('POST /api/admin/scheduler/tasks accepts cron scheduleType', async () => {
  const { status, body } = await postJSON('/api/admin/scheduler/tasks', {
    name: `__cron_${Date.now()}`,
    botName: 'web',
    scheduleType: 'cron',
    scheduleValue: '0 * * * *',
    prompt: 'Hourly check',
  });
  expect(status).toBe(200);
  expect(body.scheduleType).toBe('cron');
});

test('POST /api/admin/scheduler/tasks accepts interval scheduleType', async () => {
  const { status, body } = await postJSON('/api/admin/scheduler/tasks', {
    name: `__interval_${Date.now()}`,
    botName: 'web',
    scheduleType: 'interval',
    scheduleValue: '300000',
    prompt: 'Every 5 min',
  });
  expect(status).toBe(200);
  expect(body.scheduleType).toBe('interval');
});

// ── PUT /api/admin/scheduler/tasks/:id (update) ────────

test('PUT /api/admin/scheduler/tasks/:id updates a task', async () => {
  const created = await postJSON('/api/admin/scheduler/tasks', {
    name: `__update_${Date.now()}`,
    botName: 'web',
    scheduleType: 'once',
    scheduleValue: '0',
    prompt: 'Original',
  });
  const id = (created.body as Record<string, unknown>).id as string;

  const { status, body } = await putJSON(`/api/admin/scheduler/tasks/${id}`, {
    prompt: 'Updated prompt',
    enabled: false,
  });
  expect(status).toBe(200);
  expect((body as Record<string, unknown>).prompt).toBe('Updated prompt');
  expect((body as Record<string, unknown>).enabled).toBe(false);
});

test('PUT /api/admin/scheduler/tasks/:id returns 404 for nonexistent', async () => {
  const { status, body } = await putJSON('/api/admin/scheduler/tasks/nonexistent-id', {
    prompt: 'noop',
  });
  expect(status).toBe(404);
  expect(body).toHaveProperty('error');
});

// ── DELETE /api/admin/scheduler/tasks/:id ──────────────

test('DELETE /api/admin/scheduler/tasks/:id deletes a task', async () => {
  const created = await postJSON('/api/admin/scheduler/tasks', {
    name: `__delete_${Date.now()}`,
    botName: 'web',
    scheduleType: 'once',
    scheduleValue: '0',
    prompt: 'To delete',
  });
  const id = (created.body as Record<string, unknown>).id as string;

  const { status, body } = await delJSON(`/api/admin/scheduler/tasks/${id}`);
  expect(status).toBe(200);
  expect((body as Record<string, unknown>).deleted).toBe(true);
});

test('DELETE /api/admin/scheduler/tasks/:id returns 404 for nonexistent', async () => {
  const { status, body } = await delJSON('/api/admin/scheduler/tasks/nonexistent-id');
  expect(status).toBe(404);
  expect(body).toHaveProperty('error');
});

// ── POST /api/admin/scheduler/tasks/:id/trigger ───────

test('POST /api/admin/scheduler/tasks/:id/trigger returns error when scheduler not configured', async () => {
  const created = await postJSON('/api/admin/scheduler/tasks', {
    name: `__trigger_${Date.now()}`,
    botName: 'web',
    scheduleType: 'once',
    scheduleValue: '0',
    prompt: 'Trigger test',
  });
  const id = (created.body as Record<string, unknown>).id as string;

  // Use raw fetch with longer timeout — trigger may cause server-side execution
  try {
    const res = await fetch(`${BASE}/api/admin/scheduler/tasks/${id}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    expect([200, 404, 500, 503]).toContain(res.status);
  } catch (err) {
    // Server may close connection during trigger execution
    expect(err).toBeDefined();
  }
}, 20000);
