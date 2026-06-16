import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { ConversationArchiver } from '../src/archiver.js';

const TMP_DIR = '/tmp/happycompany-test-archiver';

function cleanTmpDir(): void {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

function createMockStore(
  overrides: Partial<{
    getMessagesForChat: (
      chatId: string,
      limit: number,
    ) => Array<{ text: string; source: string; timestamp: number }>;
  }> = {},
) {
  return {
    getMessagesForChat:
      overrides.getMessagesForChat ?? (() => []),
  } as any;
}

function makeMessages(count: number): Array<{
  text: string;
  source: string;
  timestamp: number;
}> {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    text: i % 2 === 0 ? `User message ${i}` : `Bot reply ${i}`,
    source: i % 2 === 0 ? 'user' : 'bot',
    timestamp: now - (count - i) * 1000,
  }));
}

describe('ConversationArchiver', () => {
  let archiver: ConversationArchiver;

  beforeEach(() => {
    cleanTmpDir();
    archiver = new ConversationArchiver(TMP_DIR);
  });

  afterEach(() => {
    cleanTmpDir();
  });

  // ── maybeArchive ────────────────────────────────────────────

  describe('maybeArchive', () => {
    it('returns false for conversations below threshold', async () => {
      const store = createMockStore({
        getMessagesForChat: () => makeMessages(10),
      });

      const result = await archiver.maybeArchive('bot', 'chat-1', store);
      expect(result).toBe(false);
    });

    it('returns true and creates archive file when threshold met', async () => {
      const messages = makeMessages(50);
      const store = createMockStore({
        getMessagesForChat: () => messages,
      });

      const result = await archiver.maybeArchive('bot', 'chat-1', store);
      expect(result).toBe(true);

      const botDir = join(TMP_DIR, 'conversations', 'bot');
      expect(existsSync(botDir)).toBe(true);
      const files = existsSync(botDir)
        ? require('fs').readdirSync(botDir)
        : [];
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-.*\.md$/);
    });

    it('creates markdown with correct structure', async () => {
      const messages = makeMessages(50);
      const store = createMockStore({
        getMessagesForChat: () => messages,
      });

      await archiver.maybeArchive('bot', 'chat-test-id-12345', store);

      const botDir = join(TMP_DIR, 'conversations', 'bot');
      const files = require('fs').readdirSync(botDir);
      const content = readFileSync(join(botDir, files[0]), 'utf-8');

      expect(content).toContain('# bot - chat-test-id-12345');
      expect(content).toContain('> Archived:');
      expect(content).toContain('> Messages: 50');
      expect(content).toContain('### User [');
      expect(content).toContain('### Bot [');
    });
  });

  // ── listArchives ────────────────────────────────────────────

  describe('listArchives', () => {
    it('returns empty array for unknown bot', () => {
      const records = archiver.listArchives('nonexistent');
      expect(records).toEqual([]);
    });

    it('returns sorted list of archives', async () => {
      // Use different last messages so filenames differ
      const messagesA = makeMessages(49);
      messagesA.push({
        text: 'Topic alpha discussion',
        source: 'user',
        timestamp: Date.now(),
      });
      const messagesB = makeMessages(49);
      messagesB.push({
        text: 'Topic beta discussion',
        source: 'user',
        timestamp: Date.now(),
      });

      const storeA = createMockStore({
        getMessagesForChat: () => messagesA,
      });
      const storeB = createMockStore({
        getMessagesForChat: () => messagesB,
      });

      await archiver.maybeArchive('bot', 'chat-1', storeA);
      await archiver.maybeArchive('bot', 'chat-2', storeB);

      const records = archiver.listArchives('bot');
      expect(records.length).toBeGreaterThanOrEqual(2);

      // Each record should have required fields
      for (const rec of records) {
        expect(rec.file).toMatch(/\.md$/);
        expect(rec.botName).toBe('bot');
        expect(typeof rec.title).toBe('string');
        expect(typeof rec.createdAt).toBe('string');
      }
    });
  });

  // ── readArchive ─────────────────────────────────────────────

  describe('readArchive', () => {
    it('returns file content', async () => {
      const store = createMockStore({
        getMessagesForChat: () => makeMessages(50),
      });

      await archiver.maybeArchive('bot', 'chat-1', store);
      const records = archiver.listArchives('bot');
      const filename = records[0].file;

      const content = archiver.readArchive('bot', filename);
      expect(content).toContain('# bot -');
      expect(content).toContain('Messages: 50');
    });

    it('blocks path traversal', () => {
      expect(() => archiver.readArchive('bot', '../../../etc/passwd')).toThrow(
        'Path traversal blocked',
      );
      expect(() => archiver.readArchive('bot', '../../secret.md')).toThrow(
        'Path traversal blocked',
      );
    });
  });

  // ── extractTitle (tested indirectly via maybeArchive) ───────

  describe('extractTitle behavior', () => {
    it('uses last user message as title', async () => {
      const messages = makeMessages(49);
      messages.push({
        text: 'Final user question here',
        source: 'user',
        timestamp: Date.now(),
      });

      const store = createMockStore({
        getMessagesForChat: () => messages,
      });

      await archiver.maybeArchive('bot', 'chat-1', store);
      const records = archiver.listArchives('bot');
      expect(records[0].title).toContain('Final user question here');
    });

    it('truncates long titles to 40 chars', async () => {
      const messages = makeMessages(49);
      messages.push({
        text: 'A'.repeat(100),
        source: 'user',
        timestamp: Date.now(),
      });

      const store = createMockStore({
        getMessagesForChat: () => messages,
      });

      await archiver.maybeArchive('bot', 'chat-1', store);
      const records = archiver.listArchives('bot');
      // Title is extracted from filename, which includes date prefix
      // so the title portion itself should be <= 40 chars
      expect(records[0].title.length).toBeLessThanOrEqual(40);
    });

    it('sanitizes special characters in title', async () => {
      const messages = makeMessages(49);
      messages.push({
        text: 'What is <the>: "answer" / to \\ life | ? *',
        source: 'user',
        timestamp: Date.now(),
      });

      const store = createMockStore({
        getMessagesForChat: () => messages,
      });

      await archiver.maybeArchive('bot', 'chat-1', store);
      const records = archiver.listArchives('bot');
      // Title should not contain filesystem-unsafe characters
      expect(records[0].title).not.toMatch(/[<>:"/\\|?*]/);
    });

    it('produces "untitled" when all messages are empty', async () => {
      const messages = Array.from({ length: 50 }, (_, i) => ({
        text: '',
        source: i % 2 === 0 ? 'user' : 'bot',
        timestamp: Date.now() - (50 - i) * 1000,
      }));

      const store = createMockStore({
        getMessagesForChat: () => messages,
      });

      await archiver.maybeArchive('bot', 'chat-1', store);
      const records = archiver.listArchives('bot');
      expect(records[0].title).toBe('untitled');
    });
  });
});
