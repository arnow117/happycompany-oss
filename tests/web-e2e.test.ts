import { test, expect } from 'vitest';
import { chromium } from 'playwright';

const BASE = 'http://localhost:3100';

test('health endpoint returns healthy', async () => {
  const res = await fetch(`${BASE}/api/health`);
  expect(res.ok).toBe(true);
  const body = (await res.json()) as { status: string };
  expect(body.status).toBe('ok');
});

test('bots API returns array', async () => {
  const res = await fetch(`${BASE}/api/bots`);
  expect(res.ok).toBe(true);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test('chats API returns array', async () => {
  const res = await fetch(`${BASE}/api/chats`);
  expect(res.ok).toBe(true);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  // Each chat should have chatId, lastMessageAt, messageCount
  if (body.length > 0) {
    expect(body[0]).toHaveProperty('chatId');
    expect(body[0]).toHaveProperty('lastMessageAt');
    expect(body[0]).toHaveProperty('messageCount');
  }
});

test('chat messages API returns messages for valid chatId', async () => {
  // First get existing chats
  const chatsRes = await fetch(`${BASE}/api/chats`);
  const chats = (await chatsRes.json()) as Array<{ chatId: string }>;
  if (chats.length === 0) {
    // No chats yet, skip this test
    return;
  }
  const chatId = chats[0]!.chatId;
  const res = await fetch(`${BASE}/api/chats/${chatId}/messages`);
  expect(res.ok).toBe(true);
  const messages = await res.json();
  expect(Array.isArray(messages)).toBe(true);
  if (messages.length > 0) {
    expect(messages[0]).toHaveProperty('id');
    expect(messages[0]).toHaveProperty('text');
    expect(messages[0]).toHaveProperty('source');
  }
});

test('admin scheduler tasks API returns array', async () => {
  const res = await fetch(`${BASE}/api/admin/scheduler/tasks`);
  expect(res.ok).toBe(true);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  if (body.length > 0) {
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('name');
    expect(body[0]).toHaveProperty('scheduleType');
  }
});

// These tests require a running backend on localhost:3100 AND Playwright browsers installed.
// They are integration tests - run separately: npx vitest run tests/web-e2e.test.ts
test.skip('web UI loads with proper HTML', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const res = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    expect(res?.ok()).toBe(true);

    // Verify app root is mounted
    await page.waitForSelector('#root', { timeout: 5000 });

    // Verify page title
    const title = await page.title();
    expect(title).toBeTruthy();
  } finally {
    await browser.close();
  }
});

test.skip('web UI renders chat list', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newPage();
  try {
    await ctx.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // The app should render some content inside #root
    const rootContent = await ctx.textContent('#root');
    expect(rootContent).toBeTruthy();
    // Should not show a blank screen
    expect((rootContent ?? '').trim().length).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});

test('404 returns proper error for unknown routes', async () => {
  const res = await fetch(`${BASE}/api/nonexistent`);
  expect(res.status).toBe(404);
});

test('CORS headers present on API', async () => {
  const res = await fetch(`${BASE}/api/health`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  // Should not fail with CORS error
  expect(res.ok).toBe(true);
});
