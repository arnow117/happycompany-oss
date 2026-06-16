import { describe, it, expect, vi } from 'vitest';
import { BotManager } from '../src/bot.js';
import type { BotConfig, NormalizedMessage } from '../src/types.js';
import type { ChannelAdapter, StreamingHandle } from '../src/channel.js';
import type { RespondOptions } from '../src/bot.js';
import { MessageBus } from '../src/bus.js';
import { MessageStore } from '../src/store.js';
import { DedupCache } from '../src/dedup.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:os';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import type { LoadedEmployee } from '../src/orchestrator/employee-loader.js';
import type { RuntimeEmployeeDirectory, RuntimeRegisteredEmployee } from '../src/runtime-resolver.js';

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
    chatId: 'chat-001',
    text: 'hello',
    source: 'user',
    channelId: 'feishu',
    receivedAt: 1000,
    ...overrides,
  };
}

function createMockChannel(name = 'feishu'): {
  channel: ChannelAdapter;
  triggerMessage: (msg: NormalizedMessage) => Promise<void>;
  getLastSent: () => { chatId: string; text: string } | undefined;
} {
  const handlers: Array<(msg: NormalizedMessage) => void | Promise<void>> = [];
  let lastSent: { chatId: string; text: string } | undefined;

  // Track promises from fire-and-forget handlers so tests can await them
  let pendingPromise: Promise<void> | undefined;

  const channel: ChannelAdapter = {
    name,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn((handler) => {
      // Wrap handler to capture any returned promise
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
    send: vi.fn(async (chatId, text) => {
      lastSent = { chatId, text };
    }),
    sendStreaming: vi.fn(() => createMockStreamingHandle()),
    react: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue({ type: 'file', name: 'f.txt', localPath: '/tmp/f' }),
  };

  return {
    channel,
    triggerMessage: async (msg) => {
      // Clear any prior pending promise
      pendingPromise = undefined;
      for (const handler of handlers) {
        handler(msg);
      }
      // Await any promise captured from the fire-and-forget handler
      if (pendingPromise) await pendingPromise;
    },
    getLastSent: () => lastSent,
  };
}

function createMockStreamingHandle(): StreamingHandle {
  return {
    update: vi.fn(),
    finalize: vi.fn(),
    updateToolStatus: vi.fn(),
    abort: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockAgentFactory(): {
  agent: {
    respond: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    clearAllSessions: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
  };
} {
  return {
    agent: {
      respond: vi.fn().mockResolvedValue('Agent reply here.'),
      clearSession: vi.fn(),
      clearAllSessions: vi.fn().mockReturnValue(0),
      listSessions: vi.fn().mockReturnValue([]),
    },
  };
}

function setupStore(): MessageStore {
  const dir = pjoin(tmpdir(), `bot-test-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return new MessageStore(pjoin(dir, 'test.db'));
}

class FixtureEmployeeDirectory implements RuntimeEmployeeDirectory {
  private readonly employees = new Map<string, RuntimeRegisteredEmployee>();

  add(employee: LoadedEmployee): void {
    this.employees.set(`${employee.tenantName}:${employee.id}`, { app: employee });
  }

  get(appId: string, tenantName?: string): RuntimeRegisteredEmployee | undefined {
    return tenantName ? this.employees.get(`${tenantName}:${appId}`) : undefined;
  }
}

function makeRuntimeEmployee(id: string, tenantName = 'tenant-a'): LoadedEmployee {
  return {
    id,
    tenantName,
    displayName: id,
    description: '',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are helpful.',
    maxTurns: 50,
    tools: [],
    skills: [],
    workspace: `agents/${id}`,
    role: 'member',
    allowedTargets: [],
    capabilities: [],
    source: 'prepopulated',
    createdAt: 1,
    filePath: '',
    loadedAtMs: 1,
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('BotManager', () => {
  it('creates bots from config and publishes bot_connected events', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const events: Array<{ type: string; botName?: string }> = [];
    bus.subscribe((ev) => events.push({ type: ev.type, botName: ev.botName }));

    const channelA = createMockChannel();
    const channelB = createMockChannel();

    const manager = new BotManager({
      config: {
        bots: {
          'bot-a': makeBotConfig({ channel: 'feishu' }),
          'bot-b': makeBotConfig({ channel: 'dingtalk' }),
        },
      },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({
      'bot-a': channelA.channel,
      'bot-b': channelB.channel,
    });

    expect(manager.listBots()).toEqual(['bot-a', 'bot-b']);
    expect(channelA.channel.start).toHaveBeenCalledOnce();
    expect(channelB.channel.start).toHaveBeenCalledOnce();
    expect(events).toEqual([
      { type: 'bot_connected', botName: 'bot-a' },
      { type: 'bot_connected', botName: 'bot-b' },
    ]);

    store.close();
  });

  it('throws when a configured bot has no matching channel', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const manager = new BotManager({
      config: {
        bots: {
          orphan: makeBotConfig(),
        },
      },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await expect(manager.start({})).rejects.toThrow('No channel for bot "orphan"');

    store.close();
  });

  it('routes message to agent and stores the reply', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage();
    await channel.triggerMessage(msg);

    // Agent was called with the message text + botName
    expect(agent.agent.respond).toHaveBeenCalledWith(
      'hello',
      'chat-001',
      'test',
      expect.objectContaining({ onText: expect.any(Function) }),
    );

    // Reply was stored
    const messages = store.listMessages('chat-001');
    const reply = messages.find((m) => m.id === 'msg-001:reply');
    expect(reply).toBeDefined();
    expect(reply!.text).toBe('Agent reply here.');
    expect(reply!.source).toBe('bot');

    // Bus events fired
    const events: Array<{ type: string }> = [];
    bus.subscribe((ev) => events.push({ type: ev.type }));
    // (events from start already published; check new ones by inspecting snapshot)
    const snapshot = bus.snapshot();
    const received = snapshot.find(
      (e) => e.type === 'message_received' && e.messageId === 'msg-001',
    );
    const sent = snapshot.find(
      (e) => e.type === 'agent_reply_sent' && e.chatId === 'chat-001',
    );
    expect(received).toBeDefined();
    expect(sent).toBeDefined();

    store.close();
  });

  it('resolves IM messages into runtime employee sessions when bindings exist', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();
    const corpDir = pjoin(tmpdir(), `bot-runtime-corp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(pjoin(corpDir, 'tenant-a'), { recursive: true });
    writeFileSync(pjoin(corpDir, 'tenant-a', 'people.json'), JSON.stringify([
      {
        userId: 'user-im',
        name: 'IM 用户',
        departments: [],
        status: 'active',
        source: 'manual',
        syncedAt: 1,
        updatedAt: 1,
        entryEmployee: 'sales-zhangsan',
      },
    ], null, 2), 'utf-8');
    const employees = new FixtureEmployeeDirectory();
    employees.add(makeRuntimeEmployee('sales-zhangsan'));

    const channel = createMockChannel();
    const manager = new BotManager({
      config: {
        bots: {
          'im-entry': makeBotConfig({
            channel: 'feishu',
            tenant: 'tenant-a',
            routingMode: 'employee-director',
          }),
        },
      },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
      corpDir,
      employeeManager: employees,
    });

    await manager.start({ 'im-entry': channel.channel });

    await channel.triggerMessage(makeMessage({
      id: 'im-msg-001',
      chatId: 'im-chat-001',
      text: '报价多少',
      fromUserId: 'user-im',
    }));

    expect(agent.agent.respond).toHaveBeenCalledWith(
      '报价多少',
      'im-chat-001',
      'sales-zhangsan',
      expect.objectContaining({
        tenant: 'tenant-a',
        userId: 'user-im',
      }),
    );
    const sessionId = 'tenant-a:im-entry:user-im:sales-zhangsan:im-chat-001';
    expect(store.getRuntimeSession(sessionId)).toEqual(expect.objectContaining({
      id: sessionId,
      tenant: 'tenant-a',
      entryId: 'im-entry',
      channel: 'feishu',
      actorId: 'user-im',
      employeeId: 'sales-zhangsan',
      mode: 'single_employee',
    }));
    expect(store.listMessagesForSession(sessionId).map((item) => ({
      source: item.source,
      employeeId: item.employeeId,
      text: item.text,
    }))).toEqual([
      { source: 'user', employeeId: 'sales-zhangsan', text: '报价多少' },
      { source: 'bot', employeeId: 'sales-zhangsan', text: 'Agent reply here.' },
    ]);

    store.close();
    rmSync(corpDir, { recursive: true, force: true });
  });

  it('passes fromUserId to agentFactory.respond and stores it', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({ fromUserId: 'user_456' });
    await channel.triggerMessage(msg);

    expect(agent.agent.respond).toHaveBeenCalledWith(
      'hello',
      'chat-001',
      'test',
      expect.objectContaining({ userId: 'user_456' }),
    );

    const messages = store.listMessages('chat-001');
    const userMsg = messages.find((m) => m.id === 'msg-001');
    expect(userMsg).toBeDefined();
    expect(userMsg!.userId).toBe('user_456');

    store.close();
  });

  it('handles /clear command without calling agent', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({ text: '/clear' });
    await channel.triggerMessage(msg);

    // clearSession called on agent
    expect(agent.agent.clearSession).toHaveBeenCalledWith('chat-001', 'test');
    // Agent respond NOT called
    expect(agent.agent.respond).not.toHaveBeenCalled();
    // Channel sent ack
    const last = channel.getLastSent();
    expect(last).toEqual({ chatId: 'chat-001', text: '会话已清除' });

    store.close();
  });

  it('handles /clear with trailing whitespace', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({ text: '/clear ' });
    await channel.triggerMessage(msg);

    expect(agent.agent.clearSession).toHaveBeenCalledWith('chat-001', 'test');
    expect(agent.agent.respond).not.toHaveBeenCalled();

    store.close();
  });

  it('does not forward duplicate messages (dedup)', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage();
    await channel.triggerMessage(msg);
    await channel.triggerMessage(msg); // Same message ID

    // Agent should only be called once
    expect(agent.agent.respond).toHaveBeenCalledOnce();

    store.close();
  });

  it('appends file text content to the prompt', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
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
          name: 'notes.txt',
          localPath: '/tmp/notes.txt',
          textContent: 'Line one\nLine two',
        },
      ],
    });
    await channel.triggerMessage(msg);

    const calledPrompt = agent.agent.respond.mock.calls[0]?.[0] as string;
    expect(calledPrompt).toContain('summarize this');
    expect(calledPrompt).toContain('notes.txt content');
    expect(calledPrompt).toContain('Line one\nLine two');

    store.close();
  });

  it('ignores files without textContent (download not available)', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channel = createMockChannel();
    // downloadFile rejects — file download fails gracefully
    (channel.channel.downloadFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('No file key'),
    );
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage({
      text: 'look at this image',
      files: [
        {
          type: 'image',
          name: 'photo.png',
          localPath: '/tmp/photo.png',
        },
      ],
    });
    await channel.triggerMessage(msg);

    // Should still respond — download failure is non-fatal
    expect(agent.agent.respond).toHaveBeenCalledOnce();
    const calledPrompt = agent.agent.respond.mock.calls[0]?.[0] as string;
    expect(calledPrompt).toContain('look at this image');
    // No image content injected since download failed and no base64
    expect(calledPrompt).not.toContain('[Image attached');

    store.close();
  });

  it('downloads files without textContent via channel.downloadFile', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channel = createMockChannel();
    (channel.channel.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: 'file',
      name: 'report.csv',
      localPath: '/tmp/report.csv',
      textContent: 'id,name\n1,Alice',
    });
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
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
          name: 'report.csv',
          localPath: '',
        },
      ],
    });
    await channel.triggerMessage(msg);

    expect(channel.channel.downloadFile).toHaveBeenCalledWith({
      messageId: 'msg-001',
      fileName: 'report.csv',
    });
    const calledPrompt = agent.agent.respond.mock.calls[0]?.[0] as string;
    expect(calledPrompt).toContain('report.csv content');
    expect(calledPrompt).toContain('id,name\n1,Alice');

    store.close();
  });

  it('queues concurrent messages for the same chat', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    // Simulate slow agent (200ms per response)
    let resolveFirst: () => void;
    const firstCall = new Promise<string>((r) => { resolveFirst = r; });
    agent.agent.respond = vi.fn()
      .mockResolvedValueOnce(firstCall)
      .mockResolvedValueOnce('Second reply');

    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    // Fire two messages simultaneously
    const p1 = channel.triggerMessage(makeMessage({ id: 'msg-001', text: 'first' }));
    const p2 = channel.triggerMessage(makeMessage({ id: 'msg-002', text: 'second' }));

    // First should be in-flight, second queued
    await vi.waitFor(() => expect(agent.agent.respond).toHaveBeenCalledOnce(), { timeout: 500 });

    // Resolve first — second should then process
    resolveFirst!();
    await p1;
    await p2;

    expect(agent.agent.respond).toHaveBeenCalledTimes(2);
    expect(agent.agent.respond.mock.calls[0]?.[0]).toBe('first');
    expect(agent.agent.respond.mock.calls[1]?.[0]).toBe('second');

    store.close();
  });

  it('publishes bot_disconnected events on stop', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const events: Array<{ type: string; botName?: string }> = [];
    bus.subscribe((ev) => events.push({ type: ev.type, botName: ev.botName }));

    const channel = createMockChannel();
    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });
    events.length = 0; // Clear start events

    await manager.stop();

    expect(channel.channel.stop).toHaveBeenCalledOnce();
    expect(manager.listBots()).toEqual([]);
    expect(events).toEqual([
      { type: 'bot_disconnected', botName: 'test' },
    ]);

    store.close();
  });

  it('continues stopping other bots if one channel stop throws', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    const channelA = createMockChannel('a');
    const channelB = createMockChannel('b');
    (channelB.channel.stop as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connection lost'),
    );

    const events: Array<{ type: string; botName?: string }> = [];
    bus.subscribe((ev) => events.push({ type: ev.type, botName: ev.botName }));

    const manager = new BotManager({
      config: {
        bots: {
          'bot-a': makeBotConfig(),
          'bot-b': makeBotConfig(),
        },
      },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({
      'bot-a': channelA.channel,
      'bot-b': channelB.channel,
    });
    events.length = 0;

    // Should NOT throw -- error is caught and logged
    await manager.stop();

    expect(manager.listBots()).toEqual([]);
    // Both disconnected events published despite error
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('bot_disconnected');
    expect(events[1].type).toBe('bot_disconnected');

    store.close();
  });

  it('can add a bot after updating runtime config', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();
    const channel = createMockChannel('dingtalk');

    const manager = new BotManager({
      config: { bots: {} },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    manager.updateBotConfig({
      'acme-dingtalk': makeBotConfig({
        channel: 'dingtalk',
        displayName: '示例医疗钉钉助手',
        tenant: 'acme',
        routingMode: 'employee-director',
      }),
    });

    await manager.addBot('acme-dingtalk', channel.channel);

    expect(manager.isBotRunning('acme-dingtalk')).toBe(true);
    expect(channel.channel.start).toHaveBeenCalledOnce();

    await manager.stop();
    store.close();
  });

  it('invokes streaming callbacks during agent response', async () => {
    const bus = new MessageBus();
    const store = setupStore();
    const dedup = new DedupCache();
    const agent = createMockAgentFactory();

    // Make respond fire streaming callbacks
    agent.agent.respond = vi.fn(async (prompt, chatId, botName, opts?: RespondOptions) => {
      opts?.onText?.('Hello');
      opts?.onText?.('Hello world');
      opts?.onToolStart?.({ toolName: 'Read', toolUseId: 'tu-1' });
      opts?.onToolEnd?.({ toolName: 'Read', toolUseId: 'tu-1', elapsedMs: 42 });
      return 'Hello world';
    });

    const mockHandle = createMockStreamingHandle();
    const channel = createMockChannel();
    (channel.channel.sendStreaming as ReturnType<typeof vi.fn>).mockReturnValue(mockHandle);

    const manager = new BotManager({
      config: { bots: { test: makeBotConfig() } },
      agentFactory: agent.agent,
      bus,
      store,
      dedup,
    });

    await manager.start({ test: channel.channel });

    const msg = makeMessage();
    await channel.triggerMessage(msg);

    expect(channel.channel.sendStreaming).toHaveBeenCalledWith('chat-001');
    expect(mockHandle.update).toHaveBeenCalledTimes(2);
    expect(mockHandle.update).toHaveBeenLastCalledWith('Hello world');
    expect(mockHandle.updateToolStatus).toHaveBeenCalledTimes(2);
    expect(mockHandle.updateToolStatus).toHaveBeenCalledWith({
      toolName: 'Read',
      toolUseId: 'tu-1',
      status: 'running',
    });
    expect(mockHandle.updateToolStatus).toHaveBeenCalledWith({
      toolName: 'Read',
      toolUseId: 'tu-1',
      status: 'complete',
      elapsedMs: 42,
    });
    expect(mockHandle.finalize).toHaveBeenCalledWith('Hello world');

    store.close();
  });

  describe('group chat @mention routing', () => {
    it('responds to DM without mention', async () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      const channel = createMockChannel();
      const manager = new BotManager({
        config: { bots: { test: makeBotConfig({ displayName: 'Helper' }) } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });
      await manager.start({ test: channel.channel });

      // DM chatId (ou_ prefix = Feishu DM)
      await channel.triggerMessage(makeMessage({ chatId: 'ou_xxx', text: 'hello' }));
      expect(agent.agent.respond).toHaveBeenCalledOnce();
      store.close();
    });

    it('responds in group when bot is @mentioned by name', async () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      const channel = createMockChannel();
      const manager = new BotManager({
        config: { bots: { test: makeBotConfig({ displayName: 'Test Bot' }) } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });
      await manager.start({ test: channel.channel });

      await channel.triggerMessage(makeMessage({ chatId: 'oc_xxx', text: '@Test Bot hello' }));
      expect(agent.agent.respond).toHaveBeenCalledOnce();
      store.close();
    });

    it('ignores group message without mention', async () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      const channel = createMockChannel();
      const manager = new BotManager({
        config: { bots: { test: makeBotConfig({ displayName: 'Test Bot' }) } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });
      await manager.start({ test: channel.channel });

      await channel.triggerMessage(makeMessage({ chatId: 'oc_xxx', text: 'hello everyone' }));
      expect(agent.agent.respond).not.toHaveBeenCalled();
      store.close();
    });

    it('responds to group message without mention when groupReplyMode is all', async () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      const channel = createMockChannel();
      const manager = new BotManager({
        config: { bots: { test: makeBotConfig({ displayName: 'Test Bot', groupReplyMode: 'all' }) } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });
      await manager.start({ test: channel.channel });

      await channel.triggerMessage(makeMessage({ chatId: 'oc_xxx', text: 'hello everyone' }));
      expect(agent.agent.respond).toHaveBeenCalledOnce();
      store.close();
    });

    it('responds to dingtalk c2c (DM) without mention', async () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      const channel = createMockChannel();
      const manager = new BotManager({
        config: { bots: { test: makeBotConfig({ channel: 'dingtalk', displayName: 'DT Bot' }) } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });
      await manager.start({ test: channel.channel });

      await channel.triggerMessage(makeMessage({ chatId: 'dingtalk:c2c:abc', text: 'hi' }));
      expect(agent.agent.respond).toHaveBeenCalledOnce();
      store.close();
    });

    it('ignores dingtalk group message without mention', async () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      const channel = createMockChannel();
      const manager = new BotManager({
        config: { bots: { test: makeBotConfig({ channel: 'dingtalk', displayName: 'DT Bot' }) } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });
      await manager.start({ test: channel.channel });

      await channel.triggerMessage(makeMessage({ chatId: 'dingtalk:group:xyz', text: 'hi' }));
      expect(agent.agent.respond).not.toHaveBeenCalled();
      store.close();
    });

    it('handles agent error gracefully', async () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      agent.agent.respond = vi.fn().mockRejectedValue(new Error('Claude API timeout'));
      const mockHandle = createMockStreamingHandle();
      const channel = createMockChannel();
      (channel.channel.sendStreaming as ReturnType<typeof vi.fn>).mockReturnValue(mockHandle);
      const manager = new BotManager({
        config: { bots: { test: makeBotConfig() } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });
      await manager.start({ test: channel.channel });

      const msg = makeMessage({ chatId: 'ou_xxx', text: 'hello' });
      await channel.triggerMessage(msg);

      expect(mockHandle.finalize).toHaveBeenCalledWith(
        expect.stringContaining('错误'),
      );
      store.close();
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions exist', () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();

      const manager = new BotManager({
        config: { bots: { test: makeBotConfig() } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });

      const result = manager.listSessions('test');
      expect(result).toEqual([]);
      expect(agent.agent.listSessions).toHaveBeenCalledWith('test');

      store.close();
    });

    it('returns chatIds from agent factory', () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      agent.agent.listSessions = vi.fn().mockReturnValue(['oc_abc123', 'ou_xyz456']);

      const manager = new BotManager({
        config: { bots: { test: makeBotConfig() } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });

      const result = manager.listSessions('test');
      expect(result).toEqual(['oc_abc123', 'ou_xyz456']);
      expect(agent.agent.listSessions).toHaveBeenCalledWith('test');

      store.close();
    });
  });

  describe('clearSessionSingle', () => {
    it('delegates to agent factory clearSession', () => {
      const bus = new MessageBus();
      const store = setupStore();
      const dedup = new DedupCache();
      const agent = createMockAgentFactory();
      agent.agent.clearSession = vi.fn().mockReturnValue(true);

      const manager = new BotManager({
        config: { bots: { test: makeBotConfig() } },
        agentFactory: agent.agent,
        bus, store, dedup,
      });

      const result = manager.clearSessionSingle('test', 'oc_abc123');
      expect(result).toBe(true);
      expect(agent.agent.clearSession).toHaveBeenCalledWith('oc_abc123', 'test');

      store.close();
    });
  });
});
