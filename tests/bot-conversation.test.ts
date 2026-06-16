import { describe, it, expect, vi } from 'vitest';
import { BotManager } from '../src/bot.js';
import type { BotConfig, NormalizedMessage } from '../src/types.js';
import type { ChannelAdapter, StreamingHandle } from '../src/channel.js';
import { MessageBus } from '../src/bus.js';
import { MessageStore } from '../src/store.js';
import { DedupCache } from '../src/dedup.js';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

// ── Helpers ────────────────────────────────────────────────

let msgCounter = 0;
function nextMsgId(): string {
  return `msg-${++msgCounter}`;
}

function makeBotConfig(overrides?: Partial<BotConfig>): BotConfig {
  return {
    channel: 'web',
    credentials: {},
    displayName: 'Test Bot',
    agentDir: '/tmp/test-agent',
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: nextMsgId(),
    chatId: 'chat-001',
    text: 'hello',
    source: 'user',
    channelId: 'web',
    receivedAt: Date.now(),
    ...overrides,
  };
}

interface TrackedHandle extends StreamingHandle {
  updates: string[];
  finalized: string | null;
  toolStatuses: Array<Record<string, unknown>>;
}

function createTrackedHandle(): TrackedHandle {
  return {
    updates: [],
    finalized: null,
    toolStatuses: [],
    update: vi.fn(function (this: TrackedHandle, text: string) {
      this.updates.push(text);
    }),
    finalize: vi.fn(function (this: TrackedHandle, text: string) {
      this.finalized = text;
    }),
    updateToolStatus: vi.fn(function (this: TrackedHandle, info: Record<string, unknown>) {
      this.toolStatuses.push(info);
    }),
    abort: vi.fn(),
    delete: vi.fn(),
  };
}

function createConversationChannel(name = 'web'): {
  channel: ChannelAdapter;
  sendMessage: (msg: NormalizedMessage) => Promise<void>;
  handles: Map<string, TrackedHandle>;
} {
  const handlers: Array<(msg: NormalizedMessage) => void | Promise<void>> = [];
  const handles = new Map<string, TrackedHandle>();
  let pendingPromise: Promise<void> | undefined;

  const channel: ChannelAdapter = {
    name,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn((handler) => {
      const wrapped = (msg: NormalizedMessage) => {
        const result = handler(msg);
        if (result instanceof Promise) {
          pendingPromise = result.then(
            () => { if (pendingPromise === result) pendingPromise = undefined; },
            () => { if (pendingPromise === result) pendingPromise = undefined; },
          );
        }
      };
      handlers.push(wrapped as (msg: NormalizedMessage) => void);
      return () => {
        const idx = handlers.indexOf(wrapped);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    }),
    onCardAction: vi.fn().mockReturnValue(() => {}),
    send: vi.fn(),
    sendStreaming: vi.fn((_chatId: string) => {
      const handle = createTrackedHandle();
      handles.set(_chatId, handle);
      return handle;
    }),
    react: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue({ type: 'file', name: 'f.txt', localPath: '/tmp/f' }),
  };

  return {
    channel,
    sendMessage: async (msg) => {
      pendingPromise = undefined;
      for (const handler of handlers) {
        handler(msg);
      }
      if (pendingPromise) await pendingPromise;
    },
    handles,
  };
}

function setupStore(): MessageStore {
  const dir = pjoin(tmpdir(), `bot-conv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return new MessageStore(pjoin(dir, 'test.db'));
}

function createAgentFactory() {
  return {
    respond: vi.fn().mockResolvedValue('Default reply.'),
    clearSession: vi.fn(),
    clearAllSessions: vi.fn().mockReturnValue(0),
    listSessions: vi.fn().mockReturnValue([]),
  };
}

// ── Multi-turn Conversation Tests ──────────────────────────

describe('Multi-turn conversation', () => {
  it('handles sequential messages in the same chat', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    agent.respond
      .mockResolvedValueOnce('First reply.')
      .mockResolvedValueOnce('Second reply.')
      .mockResolvedValueOnce('Third reply.');

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    await conv.sendMessage(makeMessage({ text: 'Question 1' }));
    await conv.sendMessage(makeMessage({ text: 'Question 2' }));
    await conv.sendMessage(makeMessage({ text: 'Question 3' }));

    expect(agent.respond).toHaveBeenCalledTimes(3);
    expect(conv.handles.get('chat-001')?.finalized).toBe('Third reply.');
    store.close();
  });

  it('queues messages when agent is slow', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    let resolveFirst: (v: string) => void;
    const firstCall = new Promise<string>((r) => { resolveFirst = r; });

    agent.respond
      .mockImplementationOnce(() => firstCall)
      .mockResolvedValueOnce('Quick reply.');

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    // Send first message — agent blocks
    const send1Done = conv.sendMessage(makeMessage({ text: 'Slow question' }));
    await new Promise((r) => setTimeout(r, 20));

    // Send second while first is still pending
    const send2Done = conv.sendMessage(makeMessage({ text: 'Queued question' }));

    // Only first call should have been made so far
    expect(agent.respond).toHaveBeenCalledTimes(1);

    // Resolve first call
    resolveFirst!('Slow reply.');
    await send1Done;

    // Now second should proceed
    await send2Done;
    expect(agent.respond).toHaveBeenCalledTimes(2);

    store.close();
  });

  it('processes messages in parallel across different chats', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    let resolveA: (v: string) => void;
    let resolveB: (v: string) => void;
    const callA = new Promise<string>((r) => { resolveA = r; });
    const callB = new Promise<string>((r) => { resolveB = r; });

    agent.respond
      .mockImplementationOnce(() => callA)
      .mockImplementationOnce(() => callB);

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    // Fire both messages concurrently — different chatIds
    const sendA = conv.sendMessage(makeMessage({ chatId: 'chat-A', text: 'Hello A' }));
    const sendB = conv.sendMessage(makeMessage({ chatId: 'chat-B', text: 'Hello B' }));

    await new Promise((r) => setTimeout(r, 20));

    // Both calls should have started (different chatKeys)
    expect(agent.respond).toHaveBeenCalledTimes(2);

    resolveA!('Reply A');
    resolveB!('Reply B');
    await Promise.all([sendA, sendB]);

    expect(conv.handles.get('chat-A')?.finalized).toBe('Reply A');
    expect(conv.handles.get('chat-B')?.finalized).toBe('Reply B');

    store.close();
  });

  it('recovers after agent throws on one message', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    agent.respond
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce('Recovery reply.');

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    // First message fails
    await conv.sendMessage(makeMessage({ text: 'Bad question' }));
    const errorHandle = conv.handles.get('chat-001');
    expect(errorHandle?.finalized).toContain('错误');

    // Second message should still work
    await conv.sendMessage(makeMessage({ text: 'Good question' }));
    expect(agent.respond).toHaveBeenCalledTimes(2);
    // Last handle for chat-001 should have the recovery reply
    const handles = [...conv.handles.values()].filter(
      (h) => h.finalized && !h.finalized.includes('错误'),
    );
    expect(handles.length).toBeGreaterThan(0);

    store.close();
  });

  it('deduplicates identical messages', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    const sharedId = 'dup-msg-001';

    // First send — claim succeeds → agent processes
    await conv.sendMessage(makeMessage({ id: sharedId, text: 'Original' }));
    expect(agent.respond).toHaveBeenCalledTimes(1);

    // Second send with same id — claim fails → agent NOT called again
    await conv.sendMessage(makeMessage({ id: sharedId, text: 'Duplicate' }));
    expect(agent.respond).toHaveBeenCalledTimes(1);

    store.close();
  });

  it('streams partial text updates to handle', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    agent.respond.mockImplementationOnce(
      async (_prompt: string, _chatId: string, _botName: string, opts?: Record<string, unknown>) => {
        const onText = opts?.onText as ((t: string) => void) | undefined;
        onText?.('Hello');
        onText?.(' World');
        return 'Hello World';
      },
    );

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    await conv.sendMessage(makeMessage({ text: 'Stream test' }));

    const handle = conv.handles.get('chat-001');
    expect(handle?.updates).toEqual(['Hello', ' World']);
    expect(handle?.finalized).toBe('Hello World');

    store.close();
  });

  it('reacts to messages before starting the agent reply', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    const manager = new BotManager({
      config: {
        bots: {
          'test-bot': makeBotConfig({ reactionEmoji: 'thinking' }),
        },
      },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    await conv.sendMessage(makeMessage({ id: 'msg-react-001', text: 'React test' }));

    expect(conv.channel.react).toHaveBeenCalledWith('msg-react-001', 'thinking');
    expect(agent.respond).toHaveBeenCalledTimes(1);

    store.close();
  });

  it('reports tool start and end status', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    agent.respond.mockImplementationOnce(
      async (_prompt: string, _chatId: string, _botName: string, opts?: Record<string, unknown>) => {
        const onToolStart = opts?.onToolStart as ((i: Record<string, unknown>) => void) | undefined;
        const onToolEnd = opts?.onToolEnd as ((i: Record<string, unknown>) => void) | undefined;

        onToolStart?.({ toolName: 'search_knowledge', toolUseId: 'tu-1' });
        onToolEnd?.({ toolName: 'search_knowledge', toolUseId: 'tu-1', elapsedMs: 120 });
        return 'Found results.';
      },
    );

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    await conv.sendMessage(makeMessage({ text: 'Search for X' }));

    const handle = conv.handles.get('chat-001');
    expect(handle?.toolStatuses).toHaveLength(2);
    expect(handle?.toolStatuses[0]).toMatchObject({ toolName: 'search_knowledge', status: 'running' });
    expect(handle?.toolStatuses[1]).toMatchObject({ toolName: 'search_knowledge', status: 'complete' });

    store.close();
  });

  it('preserves message order with rapid-fire messages in same chat', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    const replies = ['Reply 1', 'Reply 2', 'Reply 3', 'Reply 4', 'Reply 5'];
    let callIndex = 0;

    // Simulate variable-latency agent
    agent.respond.mockImplementation(async () => {
      const delay = Math.floor(Math.random() * 30) + 5;
      await new Promise((r) => setTimeout(r, delay));
      return replies[callIndex++ % replies.length];
    });

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    // Fire 5 messages rapidly into the same chat
    const sends = [];
    for (let i = 0; i < 5; i++) {
      sends.push(conv.sendMessage(makeMessage({ text: `Rapid ${i}` })));
    }
    await Promise.all(sends);

    // chatLocks guarantee ordering — calls should be sequential, not concurrent
    expect(agent.respond).toHaveBeenCalledTimes(5);

    // Finalized reply should be the last one
    expect(conv.handles.get('chat-001')?.finalized).toBe('Reply 5');

    store.close();
  });

  it('stores all replies in message store for conversation history', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createAgentFactory();
    const conv = createConversationChannel();

    agent.respond
      .mockResolvedValueOnce('First stored reply.')
      .mockResolvedValueOnce('Second stored reply.');

    const manager = new BotManager({
      config: { bots: { 'test-bot': makeBotConfig() } },
      agentFactory: agent,
      bus,
      store,
      dedup,
    });
    await manager.start({ 'test-bot': conv.channel });

    const msg1 = makeMessage({ id: 'm-1', text: 'Q1' });
    const msg2 = makeMessage({ id: 'm-2', text: 'Q2' });

    await conv.sendMessage(msg1);
    await conv.sendMessage(msg2);

    // Verify replies stored via getMessagesForChat
    const history = store.getMessagesForChat('chat-001');
    const botMessages = history.filter((m) => m.source === 'bot');

    expect(botMessages).toHaveLength(2);
    const texts = botMessages.map((m) => m.text).sort();
    expect(texts).toEqual(['First stored reply.', 'Second stored reply.']);

    store.close();
  });
});
