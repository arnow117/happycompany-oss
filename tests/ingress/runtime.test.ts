import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageStore } from '../../src/store.js';
import { MessageBus } from '../../src/bus.js';
import type { BusEvent } from '../../src/bus.js';
import { MessageIngressRuntime } from '../../src/ingress/runtime.js';
import type { AgentFactory, RespondOptions } from '../../src/bot.js';

interface FakeAgentCall {
  prompt: string;
  chatId: string;
  botName: string;
  opts?: RespondOptions;
}

function makeFakeAgent(reply: string | ((prompt: string) => Promise<string>) = 'ok'): AgentFactory & { calls: FakeAgentCall[] } {
  const calls: FakeAgentCall[] = [];
  return {
    calls,
    async respond(prompt, chatId, botName, opts) {
      calls.push({ prompt, chatId, botName, opts });
      // Emit a synthetic stream + tool lifecycle so we can assert callback wiring.
      opts?.onText?.('partial');
      opts?.onToolStart?.({ toolName: 'noop', toolUseId: 'u-1' });
      opts?.onToolEnd?.({ toolName: 'noop', toolUseId: 'u-1', elapsedMs: 7 });
      if (typeof reply === 'function') return reply(prompt);
      return reply;
    },
    clearSession: () => true,
    clearAllSessions: () => 0,
    listSessions: () => [],
  };
}

function setupRuntime() {
  const dir = mkdtempSync(join(tmpdir(), 'ingress-runtime-'));
  const store = new MessageStore(join(dir, 'test.db'));
  const bus = new MessageBus();
  const events: BusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  return { dir, store, bus, events };
}

describe('MessageIngressRuntime', () => {
  let cleanup: Array<() => void> = [];

  beforeEach(() => {
    cleanup = [];
  });

  afterEach(() => {
    for (const c of cleanup) c();
  });

  it('stores user message, calls agent, stores reply, and emits both bus events', async () => {
    const { dir, store, bus, events } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const agent = makeFakeAgent('hello back');
    const runtime = new MessageIngressRuntime({ agentFactory: agent, store, bus });

    const result = await runtime.handle({
      channel: 'web',
      botName: 'web-tester',
      chatId: 'chat-runtime-1',
      text: 'hi',
      userId: 'user-1',
    });

    expect(result.reply).toBe('hello back');

    const persisted = store.getMessagesForChat('chat-runtime-1', 50);
    const sources = persisted.map((m) => m.source).sort();
    expect(sources).toEqual(['bot', 'user']);
    expect(persisted.find((m) => m.source === 'user')?.text).toBe('hi');
    expect(persisted.find((m) => m.source === 'bot')?.text).toBe('hello back');

    const types = events.map((e) => e.type);
    expect(types).toContain('message_received');
    expect(types).toContain('agent_reply_sent');

    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0].chatId).toBe('chat-runtime-1');
    expect(agent.calls[0].opts?.userId).toBe('user-1');
  });

  it('persists runtime session metadata and emits runtime-aware bus metadata when provided by the resolver', async () => {
    const { dir, store, bus, events } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    let now = 1233;
    const runtime = new MessageIngressRuntime({
      agentFactory: makeFakeAgent('runtime reply'),
      store,
      bus,
      clock: () => {
        now += 1;
        return now;
      },
    });

    await runtime.handle({
      channel: 'web',
      botName: 'sales-zhangsan',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      sessionId: 'session-runtime-1',
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:user-sales:sales-zhangsan',
      workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-runtime-2',
      mode: 'single_employee',
      chatId: 'chat-runtime-2',
      text: 'hi',
    });

    expect(store.getRuntimeSession('session-runtime-1')).toEqual({
      id: 'session-runtime-1',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      channel: 'web',
      actorId: 'user-sales',
      chatId: 'chat-runtime-2',
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:user-sales:sales-zhangsan',
      workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-runtime-2',
      mode: 'single_employee',
      createdAt: 1234,
      updatedAt: 1234,
    });
    expect(store.listRuntimeSessions({ tenant: 'tenant-a' })).toEqual([
      expect.objectContaining({
        id: 'session-runtime-1',
        messageCount: 2,
        lastMessageAt: expect.any(Number),
        preview: 'runtime reply',
      }),
    ]);
    expect(store.listMessagesForSession('session-runtime-1').map((message) => message.sessionId)).toEqual([
      'session-runtime-1',
      'session-runtime-1',
    ]);

    const runtimeMeta = expect.objectContaining({
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      sessionId: 'session-runtime-1',
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:user-sales:sales-zhangsan',
      workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-runtime-2',
      mode: 'single_employee',
    });
    expect(events.filter((event) => event.type === 'new_message')).toEqual([
      expect.objectContaining({ meta: runtimeMeta }),
      expect.objectContaining({ meta: runtimeMeta }),
    ]);
    expect(events.find((event) => event.type === 'stream_event')).toEqual(expect.objectContaining({
      meta: runtimeMeta,
    }));
    expect(events.filter((event) => event.type === 'runner_state')).toEqual([
      expect.objectContaining({ state: 'running', meta: runtimeMeta }),
      expect.objectContaining({ state: 'idle', meta: runtimeMeta }),
    ]);
  });

  it('preserves workflow group session owner while storing participant messages', async () => {
    const { dir, store, bus } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    store.upsertConversationSession({
      id: 'tenant-a:workflow:wf-1',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      channel: 'web',
      actorId: 'user-sales',
      chatId: 'workflow:wf-1',
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:workflow:wf-1',
      workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
      sdkSessionScope: 'tenant-a:workflow:wf-1',
      mode: 'workflow_group',
      createdAt: 1000,
      updatedAt: 1000,
    });
    const runtime = new MessageIngressRuntime({
      agentFactory: makeFakeAgent('finance reply'),
      store,
      bus,
      clock: () => 1100,
    });

    await runtime.handle({
      channel: 'web',
      botName: 'finance-wangwu',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      sessionId: 'tenant-a:workflow:wf-1',
      employeeId: 'finance-wangwu',
      instanceId: 'tenant-a:workflow:wf-1:finance-wangwu',
      workdir: '/corp/tenant-a/agents/finance-wangwu/user-sales',
      sdkSessionScope: 'tenant-a:workflow:wf-1',
      mode: 'workflow_group',
      chatId: 'workflow:wf-1',
      text: '核算退款',
    });

    expect(store.getRuntimeSession('tenant-a:workflow:wf-1')).toEqual(expect.objectContaining({
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:workflow:wf-1',
      workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
      mode: 'workflow_group',
    }));
    expect(store.listMessagesForSession('tenant-a:workflow:wf-1').map((message) => ({
      source: message.source,
      employeeId: message.employeeId,
    }))).toEqual([
      { source: 'user', employeeId: 'finance-wangwu' },
      { source: 'bot', employeeId: 'finance-wangwu' },
    ]);
  });

  it('captures tool start/end into the IngressTrace', async () => {
    const { dir, store, bus } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const runtime = new MessageIngressRuntime({ agentFactory: makeFakeAgent('ok'), store, bus });

    const result = await runtime.handle({
      channel: 'harness',
      botName: 'b',
      chatId: 'c',
      text: 'work',
    });

    expect(result.trace.toolCalls).toHaveLength(1);
    expect(result.trace.toolCalls[0]).toMatchObject({
      name: 'noop',
      status: 'complete',
      elapsedMs: 7,
    });
    expect(result.trace.finishedAt).toBeDefined();
    expect(result.trace.input.channel).toBe('harness');
  });

  it('attaches agent observability to bot replies', async () => {
    const { dir, store, bus, events } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const agent = makeFakeAgent('observed reply');
    agent.respond = async (prompt, chatId, botName, opts) => {
      agent.calls.push({ prompt, chatId, botName, opts });
      opts?.onInit?.({
        sessionId: 'sdk-session-1',
        model: 'claude-test',
        cwd: '/tmp/agent',
        tools: ['Read', 'handoff'],
        mcpServers: [{ name: 'tenant-tools', status: 'connected' }],
        skills: ['handoff'],
        plugins: [],
        permissionMode: 'bypassPermissions',
        claudeCodeVersion: '1.2.3',
      });
      opts?.onToolStart?.({ toolName: 'Read', toolUseId: 'tool-1', toolInput: { file: 'README.md' } });
      opts?.onToolEnd?.({ toolName: 'Read', toolUseId: 'tool-1', elapsedMs: 42 });
      opts?.onUsage?.({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 2,
        cacheCreationInputTokens: 1,
        costUSD: 0.0123,
        durationMs: 1500,
        apiDurationMs: 1200,
        numTurns: 1,
      });
      opts?.onResultSummary?.({ status: 'completed', stopReason: 'end_turn', errors: [], permissionDenials: [] });
      return 'observed reply';
    };
    const runtime = new MessageIngressRuntime({ agentFactory: agent, store, bus, clock: () => 2000 });

    await runtime.handle({
      channel: 'web',
      botName: 'web-tester',
      chatId: 'chat-observed',
      text: 'hi',
    });

    const botEvent = events.find((event) => event.type === 'new_message' && event.message?.source === 'bot');
    expect(botEvent?.message?.observability).toEqual(expect.objectContaining({
      init: expect.objectContaining({ model: 'claude-test', sessionId: 'sdk-session-1' }),
      usage: expect.objectContaining({ inputTokens: 10, outputTokens: 5, costUSD: 0.0123 }),
      summary: expect.objectContaining({ status: 'completed', stopReason: 'end_turn' }),
      toolCalls: [expect.objectContaining({ toolName: 'Read', toolUseId: 'tool-1', elapsedMs: 42, status: 'completed' })],
    }));
    expect(store.listMessages('chat-observed').find((message) => message.source === 'bot')?.observability).toEqual(
      expect.objectContaining({
        init: expect.objectContaining({ model: 'claude-test' }),
        usage: expect.objectContaining({ numTurns: 1 }),
      }),
    );
    expect(events.find((event) => event.type === 'stream_event' && event.event?.eventType === 'usage')).toEqual(
      expect.objectContaining({
        event: expect.objectContaining({ usage: expect.objectContaining({ durationMs: 1500 }) }),
      }),
    );
  });

  it('forwards onText, abortController, and timeoutMs to the agent', async () => {
    const { dir, store, bus } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const agent = makeFakeAgent('ok');
    const runtime = new MessageIngressRuntime({ agentFactory: agent, store, bus });

    const ac = new AbortController();
    const collected: string[] = [];
    await runtime.handle(
      { channel: 'web', botName: 'b', chatId: 'c', text: 'x' },
      { onText: (t) => collected.push(t), abortController: ac, timeoutMs: 1234 },
    );

    expect(collected).toEqual(['partial']);
    expect(agent.calls[0].opts?.abortController).toBe(ac);
    expect(agent.calls[0].opts?.timeoutMs).toBe(1234);
  });

  it('prepends inline attachments and file text as markdown / fenced blocks', async () => {
    const { dir, store, bus } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const agent = makeFakeAgent('ok');
    const runtime = new MessageIngressRuntime({ agentFactory: agent, store, bus });

    await runtime.handle({
      channel: 'web',
      botName: 'b',
      chatId: 'c',
      text: 'analyze',
      attachments: [{ data: 'AAAA', mimeType: 'image/png' }],
      files: [{ type: 'file', name: 'spec.md', localPath: '/tmp/spec.md', textContent: 'design notes' }],
    });

    const prompt = agent.calls[0].prompt;
    expect(prompt).toContain('data:image/png;base64,AAAA');
    expect(prompt).toContain('analyze');
    expect(prompt).toContain('design notes');
    expect(prompt).toContain('[spec.md content]');
  });

  it('attaches trace to thrown errors and records the failure stage', async () => {
    const { dir, store, bus } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const failing: AgentFactory = {
      async respond() {
        throw new Error('agent boom');
      },
      clearSession: () => true,
      clearAllSessions: () => 0,
      listSessions: () => [],
    };
    const runtime = new MessageIngressRuntime({ agentFactory: failing, store, bus });

    await expect(
      runtime.handle({ channel: 'web', botName: 'b', chatId: 'c-err', text: 'will fail' }),
    ).rejects.toMatchObject({ message: 'agent boom' });

    // User message must still be persisted even though the reply failed.
    const persisted = store.getMessagesForChat('c-err', 50);
    expect(persisted.some((m) => m.source === 'user')).toBe(true);
    expect(persisted.some((m) => m.source === 'bot')).toBe(false);
  });

  it('uses provided idGenerator and clock for deterministic ids', async () => {
    const { dir, store, bus } = setupRuntime();
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    let n = 0;
    const runtime = new MessageIngressRuntime({
      agentFactory: makeFakeAgent('ok'),
      store,
      bus,
      idGenerator: () => `det-${++n}`,
      clock: () => 5_000,
    });
    await runtime.handle({ channel: 'web', botName: 'b', chatId: 'det-chat', text: 'hi' });

    const persisted = store.listMessages('det-chat', 50);
    const userMsg = persisted.find((m) => m.source === 'user');
    const botMsg = persisted.find((m) => m.source === 'bot');
    expect(userMsg?.id).toBe('web-det-1');
    expect(botMsg?.id).toBe('web-det-1:reply');
    expect(userMsg?.timestamp).toBe(5_000);
  });
});
