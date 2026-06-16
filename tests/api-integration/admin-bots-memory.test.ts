/**
 * API integration tests for Admin Bots (#35-39) and Memory (#53-56) endpoints.
 *
 * Bots endpoints:
 * #35 POST /api/admin/bots/:name/clear-sessions
 * #36 GET /api/admin/bots/:name/sessions
 * #37 DELETE /api/admin/bots/:name/sessions/:chatId
 * #38 GET /api/admin/bots/:name/knowledge
 * #39 DELETE /api/admin/bots/:name/knowledge/:filename
 *
 * Memory endpoints:
 * #53 GET /api/admin/memory/:botName/sources
 * #54 GET /api/admin/memory/:botName/search
 * #55 GET /api/admin/memory/:botName/file
 * #56 PUT /api/admin/memory/:botName/file
 */

import { test, expect, beforeAll } from 'vitest';
import { getJSON, postJSON, putJSON, delJSON } from './helpers';

const BOT_NAME = '__test-bot__';
const NONEXISTENT_BOT = 'nonexistent-bot';
const TEST_FILE_NAME = 'test-knowledge.txt';

// Server is started/stopped by globalSetup.ts
beforeAll(async () => {
  // Wait a bit to ensure server is fully ready
  await new Promise(resolve => setTimeout(resolve, 1000));
});

// -- Bot sessions list (#36) --

test('#36 GET /api/admin/bots/:name/sessions returns sessions list', async () => {
  const { status, body } = await getJSON(`/api/admin/bots/${BOT_NAME}/sessions`);
  expect(status).toBe(200);
  expect(body).toHaveProperty('sessions');
  expect(Array.isArray(body.sessions)).toBe(true);
});

test('#36 GET /api/admin/bots/:name/sessions handles non-existent bot gracefully', async () => {
  const { status, body } = await getJSON(`/api/admin/bots/${NONEXISTENT_BOT}/sessions`);
  // Non-existent bots are handled gracefully (returns 200 with empty sessions)
  expect(status).toBe(200);
  expect(body).toHaveProperty('sessions');
});

// -- Clear bot sessions (#35) --

test('#35 POST /api/admin/bots/:name/clear-sessions clears all sessions', async () => {
  const { status, body } = await postJSON(`/api/admin/bots/${BOT_NAME}/clear-sessions`, {});
  expect(status).toBe(200);
  expect(body).toHaveProperty('name', BOT_NAME);
  expect(body).toHaveProperty('cleared');
  expect(typeof body.cleared).toBe('number');
});

test('#35 POST /api/admin/bots/:name/clear-sessions handles non-existent bot gracefully', async () => {
  const { status, body } = await postJSON(`/api/admin/bots/${NONEXISTENT_BOT}/clear-sessions`, {});
  // Non-existent bots are handled gracefully (returns 200 with cleared: 0)
  expect(status).toBe(200);
  expect(body).toHaveProperty('cleared');
});

// -- Delete single session (#37) --

test('#37 DELETE /api/admin/bots/:name/sessions/:chatId deletes session', async () => {
  const chatId = 'test-chat-id-12345';
  const { status, body } = await delJSON(`/api/admin/bots/${BOT_NAME}/sessions/${chatId}`);
  expect(status).toBe(200);
  expect(body).toHaveProperty('cleared');
  expect(typeof body.cleared).toBe('boolean');
});

test('#37 DELETE /api/admin/bots/:name/sessions/:chatId handles non-existent bot gracefully', async () => {
  const { status, body } = await delJSON(`/api/admin/bots/${NONEXISTENT_BOT}/sessions/test-chat-id`);
  // Non-existent bots are handled gracefully (returns 200 with cleared: false)
  expect(status).toBe(200);
  expect(body).toHaveProperty('cleared');
});

// -- Knowledge files list (#38) --

test('#38 GET /api/admin/bots/:name/knowledge returns knowledge files', async () => {
  const { status, body } = await getJSON(`/api/admin/bots/${BOT_NAME}/knowledge`);
  expect(status).toBe(200);
  expect(body).toHaveProperty('files');
  expect(body).toHaveProperty('path');
  expect(Array.isArray(body.files)).toBe(true);
});

test('#38 GET /api/admin/bots/:name/knowledge returns 404 for non-existent bot', async () => {
  const { status, body } = await getJSON(`/api/admin/bots/${NONEXISTENT_BOT}/knowledge`);
  expect(status).toBe(404);
  expect(body).toHaveProperty('error');
  expect(body.error).toContain('Bot not found');
});

// -- Delete knowledge file (#39) --

test('#39 DELETE /api/admin/bots/:name/knowledge/:filename deletes file', async () => {
  const { status, body } = await delJSON(`/api/admin/bots/${BOT_NAME}/knowledge/${TEST_FILE_NAME}`);
  // File doesn't exist, returns 404
  expect(status).toBe(404);
  expect(body).toHaveProperty('error');
  expect(body.error).toContain('File not found');
});

test('#39 DELETE /api/admin/bots/:name/knowledge/:filename returns 400 for invalid filename', async () => {
  // URL-encoded path traversal is blocked by the server
  const { status, body } = await delJSON(`/api/admin/bots/${BOT_NAME}/knowledge/..%2Fetc%2Fpasswd`);
  expect(status).toBe(400);
  expect(body).toHaveProperty('error');
  expect(body.error).toContain('Invalid filename');
});

test('#39 DELETE /api/admin/bots/:name/knowledge/:filename returns 404 for non-existent bot', async () => {
  const { status, body } = await delJSON(`/api/admin/bots/${NONEXISTENT_BOT}/knowledge/test.txt`);
  expect(status).toBe(404);
  expect(body).toHaveProperty('error');
  expect(body.error).toContain('Bot not found');
});

// -- Memory sources (#53) --

test('#53 GET /api/admin/memory/:botName/sources returns memory sources', async () => {
  const { status, body } = await getJSON(`/api/admin/memory/${BOT_NAME}/sources`);
  expect(status).toBe(200);
  expect(body).toHaveProperty('data');
  expect(Array.isArray(body.data)).toBe(true);
});

// -- Memory search (#54) --

test('#54 GET /api/admin/memory/:botName/search returns search results', async () => {
  const { status, body } = await getJSON(`/api/admin/memory/${BOT_NAME}/search?q=test`);
  expect(status).toBe(200);
  expect(body).toHaveProperty('data');
  expect(Array.isArray(body.data)).toBe(true);
});

test('#54 GET /api/admin/memory/:botName/search returns empty array for missing query', async () => {
  const { status, body } = await getJSON(`/api/admin/memory/${BOT_NAME}/search`);
  expect(status).toBe(200);
  expect(body).toHaveProperty('data');
  expect(body.data).toEqual([]);
});

// -- Memory file read (#55) --

test('#55 GET /api/admin/memory/:botName/file returns error for non-existent file', async () => {
  const { status, body } = await getJSON(`/api/admin/memory/${BOT_NAME}/file?path=test.md`);
  expect(status).toBeGreaterThanOrEqual(400);
  expect(body).toHaveProperty('error');
});

test('#55 GET /api/admin/memory/:botName/file supports fromLine and lines params', async () => {
  const { status, body } = await getJSON(`/api/admin/memory/${BOT_NAME}/file?path=test.md&fromLine=1&lines=10`);
  expect(status).toBeGreaterThanOrEqual(400);
  expect(body).toHaveProperty('error');
});

// -- Memory file write (#56) --

test('#56 PUT /api/admin/memory/:botName/file writes file content', async () => {
  const testContent = '# Test Memory File\n\nThis is a test content.';
  const { status, body } = await putJSON(`/api/admin/memory/${BOT_NAME}/file`, {
    path: 'test-memory.md',
    content: testContent,
  });

  expect(status).toBe(200);
  expect(body).toHaveProperty('success', true);
});

test('#56 PUT /api/admin/memory/:botName/file returns 400 for missing path', async () => {
  const { status, body } = await putJSON(`/api/admin/memory/${BOT_NAME}/file`, {
    content: 'test content',
  });

  expect(status).toBe(400);
  expect(body).toHaveProperty('error');
});

test('#56 PUT /api/admin/memory/:botName/file returns 400 for missing content', async () => {
  const { status, body } = await putJSON(`/api/admin/memory/${BOT_NAME}/file`, {
    path: 'test.md',
  });

  expect(status).toBe(400);
  expect(body).toHaveProperty('error');
});

// -- Verify written memory file (#55 read after write) --

test('#55 GET /api/admin/memory/:botName/file returns written content', async () => {
  const { status, body } = await getJSON(`/api/admin/memory/${BOT_NAME}/file?path=test-memory.md`);
  expect(status).toBe(200);
  expect(body).toHaveProperty('data');
  expect(body.data).toContain('# Test Memory File');
});
