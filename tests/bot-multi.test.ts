import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotManager } from '../src/bot.js';
import type { BotConfig, NormalizedMessage } from '../src/types.js';
import type { ChannelAdapter } from '../src/channel.js';
import { MessageBus } from '../src/bus.js';
import { MessageStore } from '../src/store.js';
import { DedupCache } from '../src/dedup.js';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

// ── Helpers ────────────────────────────────────────────────

function makeBotConfig(overrides?: Partial<BotConfig>): BotConfig {
  return {
    channel: 'feishu',
    credentials: { appId: 'test' },
    displayName: 'Test Bot',
    agentDir: '/tmp/test-agent',
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: 'msg-001',
    chatId: 'oc_group1',
    text: 'hello',
    source: 'user',
    channelId: 'feishu',
    receivedAt: 1000,
    ...overrides,
  };
}

interface MockChannelSetup {
  channel: ChannelAdapter;
  triggerMessage: (msg: NormalizedMessage) => Promise<void>;
}

function createMockChannel(): MockChannelSetup {
  const handlers: Array<(msg: NormalizedMessage) => void | Promise<void>> = [];
  let pendingPromise: Promise<void> | undefined;

  const channel: ChannelAdapter = {
    name: 'feishu',
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
    send: vi.fn().mockResolvedValue(undefined),
    sendStreaming: vi.fn(() => ({
      update: vi.fn(),
      finalize: vi.fn(),
      updateToolStatus: vi.fn(),
      abort: vi.fn(),
      delete: vi.fn(),
    })),
    react: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue({ type: 'file', name: 'f.txt', localPath: '/tmp/f' }),
  };

  return {
    channel,
    triggerMessage: async (msg) => {
      pendingPromise = undefined;
      for (const handler of handlers) {
        handler(msg);
      }
      if (pendingPromise) await pendingPromise;
    },
  };
}

function setupStore(): MessageStore {
  const dir = pjoin(tmpdir(), `bot-multi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return new MessageStore(pjoin(dir, 'test.db'));
}

// ── Tests ──────────────────────────────────────────────────

describe('Multi-bot group chat routing', () => {
  let bus: MessageBus;
  let store: MessageStore;
  let dedup: DedupCache;

  beforeEach(() => {
    bus = new MessageBus();
    store = setupStore();
    dedup = new DedupCache();
  });

  afterEach(() => {
    store.close();
  });

  it('only the mentioned bot responds in a group chat with two bots', async () => {
    const agentAlice = { respond: vi.fn().mockResolvedValue('Alice reply'), clearSession: vi.fn() };
    const agentBob = { respond: vi.fn().mockResolvedValue('Bob reply'), clearSession: vi.fn() };

    // Unified agent factory that routes by botName
    const agentFactory = {
      respond: vi.fn(async (prompt: string, chatId: string, botName: string) => {
        if (botName === 'alice') return agentAlice.respond(prompt, chatId, botName);
        if (botName === 'bob') return agentBob.respond(prompt, chatId, botName);
        return 'unknown bot';
      }),
      clearSession: vi.fn(),
      clearAllSessions: vi.fn(() => 0),
    };

    const channelAlice = createMockChannel();
    const channelBob = createMockChannel();

    const manager = new BotManager({
      config: {
        bots: {
          alice: makeBotConfig({ displayName: 'Alice Bot', channel: 'feishu' }),
          bob: makeBotConfig({ displayName: 'Bob Bot', channel: 'feishu' }),
        },
      },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({
      alice: channelAlice.channel,
      bob: channelBob.channel,
    });

    // Send a group message @mentioning only Alice
    const groupMsg = makeMessage({
      id: 'g1',
      chatId: 'oc_group1',
      text: '@Alice Bot please help me',
    });

    await channelAlice.triggerMessage(groupMsg);
    await channelBob.triggerMessage(groupMsg);

    // Alice's agent should have been called
    expect(agentAlice.respond).toHaveBeenCalled();
    // Bob's agent should NOT have been called
    expect(agentBob.respond).not.toHaveBeenCalled();

    store.close();
  });

  it('neither bot responds when no @mention in group chat', async () => {
    const agentFactory = {
      respond: vi.fn().mockResolvedValue('reply'),
      clearSession: vi.fn(),
      clearAllSessions: vi.fn(() => 0),
    };

    const channelAlice = createMockChannel();
    const channelBob = createMockChannel();

    const manager = new BotManager({
      config: {
        bots: {
          alice: makeBotConfig({ displayName: 'Alice Bot', channel: 'feishu' }),
          bob: makeBotConfig({ displayName: 'Bob Bot', channel: 'feishu' }),
        },
      },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({
      alice: channelAlice.channel,
      bob: channelBob.channel,
    });

    // Send a group message without any @mention
    const groupMsg = makeMessage({
      id: 'g2',
      chatId: 'oc_group1',
      text: 'hello everyone, how are you?',
    });

    await channelAlice.triggerMessage(groupMsg);
    await channelBob.triggerMessage(groupMsg);

    // Neither agent should respond
    expect(agentFactory.respond).not.toHaveBeenCalled();

    store.close();
  });

  it('each bot responds in its own DM regardless of @mention', async () => {
    const agentFactory = {
      respond: vi.fn().mockResolvedValue('reply'),
      clearSession: vi.fn(),
      clearAllSessions: vi.fn(() => 0),
    };

    const channelAlice = createMockChannel();
    const channelBob = createMockChannel();

    const manager = new BotManager({
      config: {
        bots: {
          alice: makeBotConfig({ displayName: 'Alice Bot', channel: 'feishu' }),
          bob: makeBotConfig({ displayName: 'Bob Bot', channel: 'feishu' }),
        },
      },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({
      alice: channelAlice.channel,
      bob: channelBob.channel,
    });

    // DM to Alice (ou_ prefix = Feishu DM)
    const dmMsg = makeMessage({
      id: 'dm1',
      chatId: 'ou_alice_dm',
      text: 'hello without mention',
    });

    await channelAlice.triggerMessage(dmMsg);
    expect(agentFactory.respond).toHaveBeenCalledTimes(1);

    // DM to Bob
    const dmMsgBob = makeMessage({
      id: 'dm2',
      chatId: 'ou_bob_dm',
      text: 'hey Bob without mention',
    });

    await channelBob.triggerMessage(dmMsgBob);
    expect(agentFactory.respond).toHaveBeenCalledTimes(2);

    store.close();
  });

  it('only one bot responds when @mentioning bot by config name', async () => {
    const agentAlice = { respond: vi.fn().mockResolvedValue('Alice reply'), clearSession: vi.fn() };
    const agentBob = { respond: vi.fn().mockResolvedValue('Bob reply'), clearSession: vi.fn() };

    const agentFactory = {
      respond: vi.fn(async (prompt: string, chatId: string, botName: string) => {
        if (botName === 'alice') return agentAlice.respond(prompt, chatId, botName);
        if (botName === 'bob') return agentBob.respond(prompt, chatId, botName);
        return 'unknown bot';
      }),
      clearSession: vi.fn(),
      clearAllSessions: vi.fn(() => 0),
    };

    const channelAlice = createMockChannel();
    const channelBob = createMockChannel();

    const manager = new BotManager({
      config: {
        bots: {
          alice: makeBotConfig({ name: 'alice', displayName: 'Alice Bot', channel: 'feishu' }),
          bob: makeBotConfig({ name: 'bob', displayName: 'Bob Bot', channel: 'feishu' }),
        },
      },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({
      alice: channelAlice.channel,
      bob: channelBob.channel,
    });

    // @mention by config name (not displayName)
    const groupMsg = makeMessage({
      id: 'g3',
      chatId: 'oc_group1',
      text: '@bob help me with something',
    });

    await channelAlice.triggerMessage(groupMsg);
    await channelBob.triggerMessage(groupMsg);

    // Alice should not respond (not mentioned)
    expect(agentAlice.respond).not.toHaveBeenCalled();
    // Bob should respond (mentioned by name)
    expect(agentBob.respond).toHaveBeenCalled();

    store.close();
  });

  it('both bots respond when each is @mentioned in separate messages', async () => {
    const agentAlice = { respond: vi.fn().mockResolvedValue('Alice reply'), clearSession: vi.fn() };
    const agentBob = { respond: vi.fn().mockResolvedValue('Bob reply'), clearSession: vi.fn() };

    const agentFactory = {
      respond: vi.fn(async (prompt: string, chatId: string, botName: string) => {
        if (botName === 'alice') return agentAlice.respond(prompt, chatId, botName);
        if (botName === 'bob') return agentBob.respond(prompt, chatId, botName);
        return 'unknown bot';
      }),
      clearSession: vi.fn(),
      clearAllSessions: vi.fn(() => 0),
    };

    const channelAlice = createMockChannel();
    const channelBob = createMockChannel();

    const manager = new BotManager({
      config: {
        bots: {
          alice: makeBotConfig({ displayName: 'Alice Bot', channel: 'feishu' }),
          bob: makeBotConfig({ displayName: 'Bob Bot', channel: 'feishu' }),
        },
      },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({
      alice: channelAlice.channel,
      bob: channelBob.channel,
    });

    // Message @mentioning Alice
    const msgAlice = makeMessage({
      id: 'g4',
      chatId: 'oc_group1',
      text: '@Alice Bot help',
    });
    await channelAlice.triggerMessage(msgAlice);
    await channelBob.triggerMessage(msgAlice);

    // Message @mentioning Bob
    const msgBob = makeMessage({
      id: 'g5',
      chatId: 'oc_group1',
      text: '@Bob Bot help too',
    });
    await channelAlice.triggerMessage(msgBob);
    await channelBob.triggerMessage(msgBob);

    // Both should have responded
    expect(agentAlice.respond).toHaveBeenCalled();
    expect(agentBob.respond).toHaveBeenCalled();

    store.close();
  });
});
