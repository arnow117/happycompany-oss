import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MessageStore } from '../src/store.js';
import { existsSync, unlinkSync } from 'node:fs';
import type { ConversationSession, WorkflowThread } from '../src/runtime-profile.js';

const TEST_DB = '/tmp/happycompany-test-store.db';

function cleanDb(): void {
  if (existsSync(TEST_DB)) {
    unlinkSync(TEST_DB);
  }
  for (const ext of ['-wal', '-shm']) {
    const p = TEST_DB + ext;
    if (existsSync(p)) {
      unlinkSync(p);
    }
  }
}

describe('MessageStore', () => {
  let store: MessageStore;

  beforeEach(() => {
    cleanDb();
    store = new MessageStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    cleanDb();
  });

  it('inserts and retrieves messages', () => {
    store.insert({
      id: 'msg-001',
      chatId: 'chat-001',
      timestamp: 1000,
      text: 'hello world',
      source: 'user',
    });

    const messages = store.listMessages('chat-001');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-001');
    expect(messages[0].text).toBe('hello world');
    expect(messages[0].source).toBe('user');
    expect(messages[0].timestamp).toBe(1000);
  });

  it('ignores duplicate inserts (same id)', () => {
    store.insert({
      id: 'msg-001',
      chatId: 'chat-001',
      timestamp: 1000,
      text: 'first version',
      source: 'user',
    });
    store.insert({
      id: 'msg-001',
      chatId: 'chat-001',
      timestamp: 2000,
      text: 'second version',
      source: 'bot',
    });

    const messages = store.listMessages('chat-001');
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('first version');
  });

  it('returns chat summaries via listChats', () => {
    store.insert({
      id: 'msg-001',
      chatId: 'chat-a',
      timestamp: 1000,
      text: 'hello a',
      source: 'user',
    });
    store.insert({
      id: 'msg-002',
      chatId: 'chat-a',
      timestamp: 2000,
      text: 'hello a again',
      source: 'bot',
    });
    store.insert({
      id: 'msg-003',
      chatId: 'chat-b',
      timestamp: 3000,
      text: 'hello b',
      source: 'user',
    });

    const chats = store.listChats();
    expect(chats).toHaveLength(2);
    expect(chats[0].chatId).toBe('chat-b');
    expect(chats[0].lastMessageAt).toBe(3000);
    expect(chats[0].messageCount).toBe(1);
    expect(chats[1].chatId).toBe('chat-a');
    expect(chats[1].lastMessageAt).toBe(2000);
    expect(chats[1].messageCount).toBe(2);
  });

  it('clearAll removes all messages and returns count', () => {
    store.insert({
      id: 'msg-001',
      chatId: 'chat-001',
      timestamp: 1000,
      text: 'hello',
      source: 'user',
    });
    store.insert({
      id: 'msg-002',
      chatId: 'chat-002',
      timestamp: 2000,
      text: 'world',
      source: 'bot',
    });

    const count = store.clearAll();
    expect(count).toBe(2);
    expect(store.listChats()).toHaveLength(0);
  });

  it('persists and retrieves userId', () => {
    store.insert({
      id: 'msg-001',
      chatId: 'chat-001',
      timestamp: 1000,
      text: 'hello',
      source: 'user',
      userId: 'user_123',
    });

    const messages = store.listMessages('chat-001');
    expect(messages).toHaveLength(1);
    expect(messages[0].userId).toBe('user_123');
  });

  it('handles messages without userId', () => {
    store.insert({
      id: 'msg-001',
      chatId: 'chat-001',
      timestamp: 1000,
      text: 'hello',
      source: 'user',
    });

    const messages = store.listMessages('chat-001');
    expect(messages[0].userId).toBeUndefined();
  });

  it('stores runtime conversation sessions and lists summaries', () => {
    const session: ConversationSession = {
      id: 'tenant-a:web:user-sales:sales:chat-1',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      channel: 'web',
      actorId: 'user-sales',
      chatId: 'chat-1',
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:user-sales:sales-zhangsan',
      workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-1',
      mode: 'single_employee',
      createdAt: 1000,
      updatedAt: 1000,
    };
    store.upsertConversationSession(session);
    store.insert({
      id: 'msg-001',
      chatId: 'chat-1',
      sessionId: session.id,
      timestamp: 1100,
      botName: 'sales-zhangsan',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:user-sales:sales-zhangsan',
      workdir: session.workdir,
      mode: 'single_employee',
      text: 'hello',
      source: 'user',
    });
    store.insert({
      id: 'msg-002',
      chatId: 'chat-1',
      sessionId: session.id,
      timestamp: 1200,
      botName: 'sales-zhangsan',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:user-sales:sales-zhangsan',
      workdir: session.workdir,
      mode: 'single_employee',
      text: 'reply',
      source: 'bot',
    });

    const found = store.getRuntimeSession(session.id);
    expect(found).toEqual(session);

    const summaries = store.listRuntimeSessions({ tenant: 'tenant-a', entryId: 'web-bot', actorId: 'user-sales' });
    expect(summaries).toEqual([
      expect.objectContaining({
        id: session.id,
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        employeeId: 'sales-zhangsan',
        messageCount: 2,
        lastMessageAt: 1200,
        preview: 'reply',
      }),
    ]);

    const messages = store.listMessagesForSession(session.id);
    expect(messages.map((msg) => msg.id)).toEqual(['msg-001', 'msg-002']);
    expect(messages[0].sessionId).toBe(session.id);
    expect(messages[0].tenant).toBe('tenant-a');

    const archived = store.archiveRuntimeSession(session.id, 1300);
    expect(archived).toEqual({
      ...session,
      updatedAt: 1300,
      archivedAt: 1300,
    });
    expect(store.listRuntimeSessions({ tenant: 'tenant-a' })).toEqual([]);
    expect(store.listRuntimeSessions({ tenant: 'tenant-a', includeArchived: true })).toEqual([
      expect.objectContaining({
        id: session.id,
        archivedAt: 1300,
      }),
    ]);
    expect(store.listMessagesForSession(session.id).map((msg) => msg.id)).toEqual(['msg-001', 'msg-002']);
  });

  it('stores and lists runtime collaboration events', () => {
    store.insertRuntimeEvent({
      id: 'event-1',
      tenant: 'tenant-a',
      sessionId: 'session-1',
      chatId: 'chat-1',
      actorId: 'user-sales',
      employeeId: 'sales-zhangsan',
      type: 'handoff_requested',
      payload: {
        fromEmployeeId: 'sales-zhangsan',
        toEmployeeId: 'maintenance-lisi',
        reason: '需要确认设备维保记录',
      },
      at: 1000,
    });
    store.insertRuntimeEvent({
      id: 'event-2',
      tenant: 'tenant-a',
      sessionId: 'session-1',
      chatId: 'chat-1',
      actorId: 'user-sales',
      employeeId: 'maintenance-lisi',
      type: 'tool_call_completed',
      payload: {
        toolName: 'maintenance.lookup_device',
        elapsedMs: 25,
      },
      at: 1100,
    });

    expect(store.listRuntimeEvents({ sessionId: 'session-1' })).toEqual([
      expect.objectContaining({
        id: 'event-1',
        type: 'handoff_requested',
        payload: expect.objectContaining({ toEmployeeId: 'maintenance-lisi' }),
      }),
      expect.objectContaining({
        id: 'event-2',
        type: 'tool_call_completed',
        payload: expect.objectContaining({ toolName: 'maintenance.lookup_device' }),
      }),
    ]);
  });

  it('stores workflow threads and appends handoff events', () => {
    const thread: WorkflowThread = {
      id: 'workflow-1',
      tenant: 'tenant-a',
      sessionId: 'tenant-a:workflow:workflow-1',
      entryId: 'web-bot',
      actorId: 'user-sales',
      ownerEmployeeId: 'sales-zhangsan',
      state: 'open',
      participants: [{
        employeeId: 'sales-zhangsan',
        instanceId: 'tenant-a:workflow:workflow-1:sales-zhangsan',
        role: 'owner',
        joinedAt: 1000,
      }],
      handoffs: [],
      summary: '报价跟进',
      createdAt: 1000,
      updatedAt: 1000,
    };
    store.upsertWorkflowThread(thread);

    expect(store.getWorkflowThread(thread.id)).toEqual(thread);
    expect(store.listWorkflowThreads({ tenant: 'tenant-a', actorId: 'user-sales' })).toEqual([thread]);

    const updated = store.appendWorkflowHandoff(thread.id, {
      fromEmployeeId: 'sales-zhangsan',
      toEmployeeId: 'finance-wangwu',
      reason: '需要核算退款',
      status: 'requested',
      at: 1200,
    }, {
      employeeId: 'finance-wangwu',
      instanceId: 'tenant-a:workflow:workflow-1:finance-wangwu',
      role: 'participant',
      joinedAt: 1200,
    });

    expect(updated).toEqual(expect.objectContaining({
      id: thread.id,
      updatedAt: 1200,
      participants: [
        thread.participants[0],
        expect.objectContaining({ employeeId: 'finance-wangwu', role: 'participant' }),
      ],
      handoffs: [expect.objectContaining({ toEmployeeId: 'finance-wangwu', reason: '需要核算退款' })],
    }));
  });
});

describe('MessageStore migration', () => {
  const LEGACY_DB = '/tmp/happycompany-test-migrate.db';

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = LEGACY_DB + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('adds missing runtime columns and sessions table to legacy DB', () => {
    // Simulate a legacy DB created before runtime session metadata was added
    const db = new Database(LEGACY_DB);
    db.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      bot_name TEXT,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      from_bot TEXT
    )`);
    db.prepare(
      "INSERT INTO messages (id, chat_id, timestamp, text, source) VALUES ('m1', 'c1', 1000, 'hello', 'user')",
    ).run();
    db.close();

    // Opening with MessageStore should trigger migration
    const store = new MessageStore(LEGACY_DB);

    const after = store.getMessagesAfter('c1', 0);
    expect(after).toHaveLength(1);
    expect(after[0].user_id).toBeNull();

    const before = store.getMessagesBefore('c1', 9999);
    expect(before).toHaveLength(1);
    expect(before[0].attachments).toBeNull();

    expect(store.listRuntimeSessions()).toEqual([]);

    store.close();
  });
});
