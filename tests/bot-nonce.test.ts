import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotManager } from '../src/bot.js';
import type { BotConfig, NormalizedMessage } from '../src/types.js';
import type { ChannelAdapter } from '../src/channel.js';
import { MessageBus } from '../src/bus.js';
import { MessageStore } from '../src/store.js';
import { DedupCache } from '../src/dedup.js';
import { mkdirSync } from 'node:fs';
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
    chatId: 'ou_dm',
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
  const dir = pjoin(tmpdir(), `bot-nonce-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return new MessageStore(pjoin(dir, 'test.db'));
}

// ── Tests ──────────────────────────────────────────────────

describe('Nonce fenced file blocks in prompt', () => {
  let bus: MessageBus;
  let store: MessageStore;
  let dedup: DedupCache;
  let agentFactory: {
    respond: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    clearAllSessions: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    bus = new MessageBus();
    store = setupStore();
    dedup = new DedupCache();
    agentFactory = {
      respond: vi.fn().mockResolvedValue('reply'),
      clearSession: vi.fn(),
      clearAllSessions: vi.fn(() => 0),
    };
  });

  afterEach(() => {
    store.close();
  });

  it('wraps file content in a fence with FILE_ prefix and 8-char nonce', async () => {
    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({
      text: 'summarize this',
      files: [
        {
          type: 'file',
          name: 'report.txt',
          localPath: '/tmp/report.txt',
          textContent: 'Line one\nLine two',
        },
      ],
    });

    await channel.triggerMessage(msg);

    const prompt = agentFactory.respond.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('FILE_');

    // Extract the nonce fence from the prompt
    const fenceMatch = prompt.match(/FILE_([a-z0-9]{8})/);
    expect(fenceMatch).not.toBeNull();
    expect(fenceMatch![1]).toHaveLength(8);
  });

  it('includes file name in the fence header', async () => {
    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({
      text: 'analyze',
      files: [
        {
          type: 'file',
          name: 'data.csv',
          localPath: '/tmp/data.csv',
          textContent: 'id,name\n1,Alice',
        },
      ],
    });

    await channel.triggerMessage(msg);

    const prompt = agentFactory.respond.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('[data.csv content]');
    expect(prompt).toContain('id,name\n1,Alice');
  });

  it('uses separate nonce fences for multiple files', async () => {
    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({
      text: 'compare these',
      files: [
        {
          type: 'file',
          name: 'file-a.txt',
          localPath: '/tmp/a.txt',
          textContent: 'Content of file A',
        },
        {
          type: 'file',
          name: 'file-b.txt',
          localPath: '/tmp/b.txt',
          textContent: 'Content of file B',
        },
      ],
    });

    await channel.triggerMessage(msg);

    const prompt = agentFactory.respond.mock.calls[0]?.[0] as string;

    // Each fence appears twice (open + close), so 2 files = 4 fence occurrences
    const fenceMatches = prompt.match(/FILE_[a-z0-9]{8}/g);
    expect(fenceMatches).not.toBeNull();
    expect(fenceMatches).toHaveLength(4);

    // Extract unique fences — should be 2 distinct nonces
    const uniqueFences = [...new Set(fenceMatches!)];
    expect(uniqueFences).toHaveLength(2);

    // Both file names should be present
    expect(prompt).toContain('[file-a.txt content]');
    expect(prompt).toContain('[file-b.txt content]');

    // Both file contents should be present
    expect(prompt).toContain('Content of file A');
    expect(prompt).toContain('Content of file B');
  });

  it('does not add fence for files without textContent', async () => {
    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({
      text: 'look at this',
      files: [
        {
          type: 'file',
          name: 'empty.txt',
          localPath: '/tmp/empty.txt',
        },
      ],
    });

    await channel.triggerMessage(msg);

    const prompt = agentFactory.respond.mock.calls[0]?.[0] as string;
    // No FILE_ fence should appear since no textContent and download fails
    expect(prompt).not.toContain('FILE_');
    expect(prompt).toContain('look at this');
  });

  it('includes base64 image indicator when base64 is present', async () => {
    const channel = createMockChannel();
    // downloadFile returns base64 for image files
    (channel.channel.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: 'image',
      name: 'photo.png',
      localPath: '/tmp/photo.png',
      base64: 'iVBORw0KGgo=',
    });
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({
      text: 'describe this image',
      files: [
        {
          type: 'image',
          name: 'photo.png',
          localPath: '/tmp/photo.png',
        },
      ],
    });

    await channel.triggerMessage(msg);

    const prompt = agentFactory.respond.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('[Image attached: photo.png]');
  });

  it('passes original text when no files are attached', async () => {
    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({
      text: 'just a simple question',
    });

    await channel.triggerMessage(msg);

    const prompt = agentFactory.respond.mock.calls[0]?.[0] as string;
    expect(prompt).toBe('just a simple question');
  });
});
