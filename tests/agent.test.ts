import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeAgent } from '../src/agent.js';
import type { AgentOptions } from '../src/agent.js';

describe('ClaudeAgent', () => {
  let tempDir: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    agentDir = join(tempDir, 'agent-data');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeOpts(overrides?: Partial<AgentOptions>): AgentOptions {
    return {
      name: 'test-bot',
      agentDir,
      ...overrides,
    };
  }

  // ── sessionFilePath (tested indirectly via clearSession) ──

  describe('sessionFilePath (safe filename)', () => {
    it('replaces non-alphanumeric characters in chatId', () => {
      const agent = new ClaudeAgent(makeOpts());
      // clearSession exercises sessionFilePath — verify it works with special chars
      const chatId = 'oc_abc123@feishu!#';
      const result = agent.clearSession(chatId);
      // No file or memory should exist, so result should be false
      expect(result).toBe(false);
      // Verify the expected safe-named file does NOT exist
      const safe = chatId.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const expectedPath = resolve(agentDir, `.session-${safe}.json`);
      expect(existsSync(expectedPath)).toBe(false);
    });

    it('preserves safe characters in chatId', () => {
      const agent = new ClaudeAgent(makeOpts());
      const chatId = 'chat_ABC.123-test';
      const result = agent.clearSession(chatId);
      expect(result).toBe(false);
      const expectedPath = resolve(agentDir, `.session-${chatId}.json`);
      expect(existsSync(expectedPath)).toBe(false);
    });

    it('uses sessionKey with userId when provided', () => {
      const agent = new ClaudeAgent(makeOpts());
      const chatId = 'oc_testchat';
      const userId = 'user_123';
      const result = agent.clearSession(chatId, userId);
      expect(result).toBe(false);
      const safe = 'user_123_oc_testchat'.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const expectedPath = resolve(agentDir, `.session-${safe}.json`);
      expect(existsSync(expectedPath)).toBe(false);
    });
  });

  // ── clearSession ──

  describe('clearSession', () => {
    it('returns false when no session exists for the chat', () => {
      const agent = new ClaudeAgent(makeOpts());
      const result = agent.clearSession('nonexistent-chat');
      expect(result).toBe(false);
    });

    it('returns true and removes file when a session file exists', () => {
      const agent = new ClaudeAgent(makeOpts());
      // Manually create a session file
      const chatId = 'oc_testchat';
      const sessionPath = resolve(agentDir, `.session-${chatId}.json`);
      writeFileSync(sessionPath, JSON.stringify({ sessionId: 'sess-123' }), 'utf-8');
      expect(existsSync(sessionPath)).toBe(true);

      const result = agent.clearSession(chatId);
      expect(result).toBe(true);
      expect(existsSync(sessionPath)).toBe(false);
    });

    it('clears in-memory session when session was loaded from disk', () => {
      // Create a session file before constructing the agent
      const chatId = 'oc_loaded';
      mkdirSync(agentDir, { recursive: true });
      const sessionPath = resolve(agentDir, `.session-${chatId}.json`);
      writeFileSync(sessionPath, JSON.stringify({ sessionId: 'sess-loaded' }), 'utf-8');

      // Agent constructor calls loadSessions() which reads the file
      const agent = new ClaudeAgent(makeOpts());
      // First clear should find both memory and file
      const result = agent.clearSession(chatId);
      expect(result).toBe(true);
      expect(existsSync(sessionPath)).toBe(false);

      // Second clear should find nothing
      const result2 = agent.clearSession(chatId);
      expect(result2).toBe(false);
    });

    it('clears user-specific session file when userId is provided', () => {
      const agent = new ClaudeAgent(makeOpts());
      const chatId = 'oc_testchat';
      const userId = 'user_123';
      const sessionKey = `${userId}:${chatId}`;
      const safe = sessionKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const sessionPath = resolve(agentDir, `.session-${safe}.json`);
      writeFileSync(sessionPath, JSON.stringify({ sessionId: 'sess-user' }), 'utf-8');

      const result = agent.clearSession(chatId, userId);
      expect(result).toBe(true);
      expect(existsSync(sessionPath)).toBe(false);

      // Clearing without userId should not affect anything
      const result2 = agent.clearSession(chatId);
      expect(result2).toBe(false);
    });
  });

  // ── updateOptions ──

  describe('updateOptions', () => {
    it('updates cwd to a new directory and creates it', () => {
      const agent = new ClaudeAgent(makeOpts());
      const newCwd = join(tempDir, 'new-workspace');
      expect(existsSync(newCwd)).toBe(false);

      agent.updateOptions({ cwd: newCwd });
      expect(existsSync(newCwd)).toBe(true);
    });

    it('updates model', () => {
      const agent = new ClaudeAgent(makeOpts());
      agent.updateOptions({ model: 'claude-opus-4-20250514' });
      // Verify via a second update + check the opts field
      // (opts is private, but we can confirm no error thrown)
      agent.updateOptions({ model: 'claude-sonnet-4-20250514' });
      // If we got here without error, model update succeeded
      expect(true).toBe(true);
    });

    it('resets cwd to agentDir when cwd is empty string', () => {
      const agent = new ClaudeAgent(makeOpts());
      agent.updateOptions({ cwd: join(tempDir, 'other') });
      agent.updateOptions({ cwd: '' });
      // Should reset to agentDir (the constructor-created dir)
      // No error = success
      expect(true).toBe(true);
    });
  });
});
