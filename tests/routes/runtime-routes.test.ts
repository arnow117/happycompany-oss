import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFactory } from '../../src/bot.js';
import { MessageBus } from '../../src/bus.js';
import type { Config } from '../../src/config.js';
import { DEFAULT_WEB_CHAT_CONFIG } from '../../src/config.js';
import { registerRuntimeRoutes } from '../../src/routes/runtime-routes.js';
import { MessageStore } from '../../src/store.js';
import type { LoadedEmployee } from '../../src/orchestrator/employee-loader.js';
import type { RuntimeEmployeeDirectory, RuntimeRegisteredEmployee } from '../../src/runtime-resolver.js';
import type { ConversationSession } from '../../src/runtime-profile.js';

class FixtureEmployeeDirectory implements RuntimeEmployeeDirectory {
  private readonly employees = new Map<string, RuntimeRegisteredEmployee>();

  add(employee: LoadedEmployee): void {
    this.employees.set(`${employee.tenantName}:${employee.id}`, { app: employee });
  }

  get(appId: string, tenantName?: string): RuntimeRegisteredEmployee | undefined {
    return tenantName ? this.employees.get(`${tenantName}:${appId}`) : undefined;
  }
}

function makeConfig(): Config {
  return {
    bots: {
      'web-bot': {
        channel: 'web',
        displayName: 'Web 入口',
        agentDir: 'agents/web-bot',
        tenant: 'tenant-a',
        routingMode: 'employee-director',
      },
    },
    claude: undefined,
    web: { port: 3100 },
    webChat: DEFAULT_WEB_CHAT_CONFIG,
    dataDir: 'data',
    corpDir: undefined,
    adminToken: undefined,
  };
}

function makeEmployee(id: string): LoadedEmployee {
  return {
    id,
    tenantName: 'tenant-a',
    displayName: id === 'sales-zhangsan' ? '销售张三' : id,
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

describe('runtime routes', () => {
  let corpDir: string;
  let dbPath: string;
  let store: MessageStore;
  let app: Hono;
  let agentFactory: AgentFactory;

  beforeEach(() => {
    corpDir = mkdtempSync(join(tmpdir(), 'runtime-routes-corp-'));
    dbPath = join(mkdtempSync(join(tmpdir(), 'runtime-routes-data-')), 'messages.db');
    mkdirSync(join(corpDir, 'tenant-a'), { recursive: true });
    writeFileSync(join(corpDir, 'tenant-a', 'people.json'), JSON.stringify([
      {
        userId: 'user-sales',
        name: '销售用户',
        departments: [],
        status: 'active',
        source: 'manual',
        syncedAt: 1,
        updatedAt: 1,
        entryEmployee: 'sales-zhangsan',
      },
    ], null, 2), 'utf-8');

    const employees = new FixtureEmployeeDirectory();
    employees.add(makeEmployee('sales-zhangsan'));
    employees.add(makeEmployee('maintenance-lisi'));
    employees.add(makeEmployee('finance-wangwu'));
    store = new MessageStore(dbPath);
    agentFactory = {
      respond: vi.fn(async (prompt: string, chatId: string, botName: string) => `${botName} handled ${chatId}: ${prompt}`),
      clearSession: vi.fn(() => true),
      clearAllSessions: vi.fn(() => 0),
      listSessions: vi.fn(() => []),
    };
    app = new Hono();
    registerRuntimeRoutes(app, {
      corpDir,
      configRef: { current: makeConfig() },
      employeeManager: employees,
      store,
      agentFactory,
      bus: new MessageBus(),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(corpDir, { recursive: true, force: true });
    rmSync(dbPath.replace(/messages\.db$/, ''), { recursive: true, force: true });
  });

  it('lists entries, actors, and targets', async () => {
    const entriesRes = await app.request('/api/runtime/entries?tenant=tenant-a');
    expect(entriesRes.status).toBe(200);
    expect(await entriesRes.json()).toEqual({
      entries: [expect.objectContaining({ id: 'web-bot', tenant: 'tenant-a', channel: 'web' })],
    });

    const actorsRes = await app.request('/api/runtime/actors?tenant=tenant-a');
    expect(actorsRes.status).toBe(200);
    expect(await actorsRes.json()).toEqual({
      actors: [expect.objectContaining({ actorId: 'user-sales', bindings: [{ employeeId: 'sales-zhangsan', isDefault: true }] })],
    });

    const targetsRes = await app.request('/api/runtime/targets?tenant=tenant-a&actorId=user-sales');
    expect(targetsRes.status).toBe(200);
    expect(await targetsRes.json()).toEqual({
      targets: [expect.objectContaining({ employeeId: 'sales-zhangsan', displayName: '销售张三', isDefault: true })],
    });
  });

  it('lists runtime sessions and session messages', async () => {
    const session: ConversationSession = {
      id: 'session-1',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      channel: 'web',
      actorId: 'user-sales',
      chatId: 'chat-1',
      employeeId: 'sales-zhangsan',
      instanceId: 'tenant-a:user-sales:sales-zhangsan',
      workdir: join(corpDir, 'tenant-a', 'agents', 'sales-zhangsan', 'user-sales'),
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-1',
      mode: 'single_employee',
      createdAt: 1000,
      updatedAt: 1000,
    };
    store.upsertConversationSession(session);
    store.insert({
      id: 'm1',
      chatId: 'chat-1',
      sessionId: session.id,
      timestamp: 1100,
      botName: 'sales-zhangsan',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      employeeId: 'sales-zhangsan',
      instanceId: session.instanceId,
      workdir: session.workdir,
      mode: 'single_employee',
      text: 'hello',
      source: 'user',
    });

    const sessionsRes = await app.request('/api/runtime/sessions?tenant=tenant-a&entryId=web-bot&actorId=user-sales');
    expect(sessionsRes.status).toBe(200);
    expect(await sessionsRes.json()).toEqual({
      sessions: [expect.objectContaining({ id: 'session-1', preview: 'hello', messageCount: 1 })],
    });

    const messagesRes = await app.request('/api/runtime/sessions/session-1/messages');
    expect(messagesRes.status).toBe(200);
    expect(await messagesRes.json()).toEqual({
      session,
      messages: [expect.objectContaining({ id: 'm1', sessionId: 'session-1', text: 'hello' })],
    });

    const archiveRes = await app.request('/api/runtime/sessions/session-1', { method: 'DELETE' });
    expect(archiveRes.status).toBe(200);
    expect(await archiveRes.json()).toEqual({
      archived: true,
      session: expect.objectContaining({ id: 'session-1', archivedAt: expect.any(Number) }),
    });

    const activeSessionsRes = await app.request('/api/runtime/sessions?tenant=tenant-a');
    expect(activeSessionsRes.status).toBe(200);
    expect(await activeSessionsRes.json()).toEqual({ sessions: [] });

    const archivedSessionsRes = await app.request('/api/runtime/sessions?tenant=tenant-a&includeArchived=true');
    expect(archivedSessionsRes.status).toBe(200);
    expect(await archivedSessionsRes.json()).toEqual({
      sessions: [expect.objectContaining({ id: 'session-1', archivedAt: expect.any(Number) })],
    });
  });

  it('paginates runtime sessions with offset', async () => {
    for (let index = 1; index <= 3; index += 1) {
      store.upsertConversationSession({
        id: `session-${index}`,
        tenant: 'tenant-a',
        entryId: index === 3 ? 'acme-dingtalk' : 'web-bot',
        channel: index === 3 ? 'dingtalk' : 'web',
        actorId: 'user-sales',
        chatId: `chat-${index}`,
        employeeId: 'sales-zhangsan',
        instanceId: `tenant-a:user-sales:sales-zhangsan:${index}`,
        workdir: join(corpDir, 'tenant-a', 'agents', 'sales-zhangsan', 'user-sales'),
        sdkSessionScope: `tenant-a:web-bot:user-sales:sales-zhangsan:chat-${index}`,
        mode: 'single_employee',
        createdAt: 1000 + index,
        updatedAt: 1000 + index,
      });
    }

    const res = await app.request('/api/runtime/sessions?tenant=tenant-a&actorId=user-sales&limit=2&offset=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ id: string }> };
    expect(body.sessions.map((session) => session.id)).toEqual(['session-2', 'session-1']);
  });

  it('sends runtime messages through resolver-owned session metadata', async () => {
    const clientSuppliedWorkdir = join(corpDir, 'tenant-a', 'agents', 'malicious');
    const res = await app.request('/api/runtime/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        chatId: 'chat-runtime-1',
        text: '你好',
        target: { employeeId: 'sales-zhangsan' },
        workdir: clientSuppliedWorkdir,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      reply: string;
      runtime: {
        employeeId: string;
        workdir: string;
        sdkSessionScope: string;
      };
      session: {
        id: string;
        tenant: string;
        entryId: string;
        actorId: string;
        employeeId: string;
        workdir: string;
        sdkSessionScope: string;
        mode: string;
      };
    };
    const expectedWorkdir = join(corpDir, 'tenant-a', 'agents', 'sales-zhangsan', 'user-sales');
    expect(body.reply).toBe('sales-zhangsan handled chat-runtime-1: 你好');
    expect(body.runtime).toEqual(expect.objectContaining({
      employeeId: 'sales-zhangsan',
      workdir: expectedWorkdir,
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-runtime-1',
    }));
    expect(body.session).toEqual(expect.objectContaining({
      id: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-runtime-1',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      employeeId: 'sales-zhangsan',
      workdir: expectedWorkdir,
      sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-runtime-1',
      mode: 'single_employee',
    }));
    expect(body.session.workdir).not.toBe(clientSuppliedWorkdir);
    expect(agentFactory.respond).toHaveBeenCalledWith(
      '你好',
      'chat-runtime-1',
      'sales-zhangsan',
      expect.objectContaining({
        tenant: 'tenant-a',
        userId: 'user-sales',
      }),
    );
    expect(store.listMessagesForSession(body.session.id).map((item) => ({
      source: item.source,
      employeeId: item.employeeId,
      text: item.text,
    }))).toEqual([
      { source: 'user', employeeId: 'sales-zhangsan', text: '你好' },
      { source: 'bot', employeeId: 'sales-zhangsan', text: 'sales-zhangsan handled chat-runtime-1: 你好' },
    ]);
  });

  it('projects runtime collaboration events into cases and timelines', async () => {
    vi.mocked(agentFactory.respond).mockImplementationOnce(async (prompt, chatId, botName, opts) => {
      opts?.onRoutingDecision?.({ selectedEmployee: botName });
      opts?.onToolStart?.({ toolName: 'maintenance.lookup_device', toolUseId: 'tool-1' });
      opts?.onHandoff?.({
        from: 'sales-zhangsan',
        to: 'maintenance-lisi',
        reason: '需要确认设备维保记录',
      });
      opts?.onToolEnd?.({ toolName: 'maintenance.lookup_device', toolUseId: 'tool-1', elapsedMs: 12 });
      return `${botName} handled ${chatId}: ${prompt}`;
    });

    const res = await app.request('/api/runtime/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        chatId: 'chat-collab-1',
        text: '请确认这台设备是否还在维保期',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { session: { id: string } };

    const casesRes = await app.request('/api/runtime/cases?tenant=tenant-a');
    expect(casesRes.status).toBe(200);
    expect(await casesRes.json()).toEqual({
      cases: [
        expect.objectContaining({
          id: body.session.id,
          currentEmployeeId: 'maintenance-lisi',
          participants: expect.arrayContaining(['sales-zhangsan', 'maintenance-lisi']),
          handoffCount: 1,
          toolCallCount: 1,
          preview: 'sales-zhangsan handled chat-collab-1: 请确认这台设备是否还在维保期',
        }),
      ],
    });

    const timelineRes = await app.request(`/api/runtime/cases/${encodeURIComponent(body.session.id)}/timeline`);
    expect(timelineRes.status).toBe(200);
    expect(await timelineRes.json()).toEqual({
      case: expect.objectContaining({ id: body.session.id, handoffCount: 1 }),
      timeline: expect.arrayContaining([
        expect.objectContaining({ type: 'user_message', text: '请确认这台设备是否还在维保期' }),
        expect.objectContaining({ type: 'routing_decision', employeeId: 'sales-zhangsan' }),
        expect.objectContaining({
          type: 'handoff',
          fromEmployeeId: 'sales-zhangsan',
          toEmployeeId: 'maintenance-lisi',
          reason: '需要确认设备维保记录',
        }),
        expect.objectContaining({ type: 'tool_call', toolName: 'maintenance.lookup_device', status: 'started' }),
        expect.objectContaining({ type: 'agent_message' }),
      ]),
    });
  });

  it('excludes sessions without handoff from collaboration cases', async () => {
    vi.mocked(agentFactory.respond).mockImplementationOnce(async (prompt, chatId, botName, opts) => {
      opts?.onRoutingDecision?.({ selectedEmployee: botName });
      opts?.onToolStart?.({ toolName: 'maintenance.lookup_device', toolUseId: 'tool-1' });
      opts?.onToolEnd?.({ toolName: 'maintenance.lookup_device', toolUseId: 'tool-1', elapsedMs: 12 });
      return `${botName} handled ${chatId}: ${prompt}`;
    });

    const res = await app.request('/api/runtime/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        chatId: 'chat-tool-only-1',
        text: '只查设备，不需要交接',
      }),
    });
    expect(res.status).toBe(200);

    const casesRes = await app.request('/api/runtime/cases?tenant=tenant-a');
    expect(casesRes.status).toBe(200);
    expect(await casesRes.json()).toEqual({ cases: [] });

    const body = await res.json() as { session: { id: string } };
    const timelineRes = await app.request(`/api/runtime/cases/${encodeURIComponent(body.session.id)}/timeline`);
    expect(timelineRes.status).toBe(404);
    expect(await timelineRes.json()).toEqual({ error: 'Case not found' });
  });

  it('creates workflow group sessions and records handoff participants', async () => {
    const createRes = await app.request('/api/runtime/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'workflow-quote-1',
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        ownerEmployeeId: 'sales-zhangsan',
        participantEmployeeIds: ['maintenance-lisi'],
        title: '报价协作',
        summary: '客户询问维修报价',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { workflow: { id: string; participants: Array<{ employeeId: string; role: string }> }; session: { mode: string; employeeId: string } };
    expect(created.session).toEqual(expect.objectContaining({
      mode: 'workflow_group',
      employeeId: 'sales-zhangsan',
    }));
    expect(created.workflow).toEqual(expect.objectContaining({
      id: 'workflow-quote-1',
      participants: [
        expect.objectContaining({ employeeId: 'sales-zhangsan', role: 'owner' }),
        expect.objectContaining({ employeeId: 'maintenance-lisi', role: 'participant' }),
      ],
    }));

    const handoffRes = await app.request('/api/runtime/workflows/workflow-quote-1/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromEmployeeId: 'sales-zhangsan',
        toEmployeeId: 'finance-wangwu',
        reason: '需要核算退款',
      }),
    });
    expect(handoffRes.status).toBe(200);
    const handoff = await handoffRes.json() as { workflow: { participants: Array<{ employeeId: string }>; handoffs: Array<{ toEmployeeId: string; reason: string }> } };
    expect(handoff.workflow.participants.map((item) => item.employeeId)).toEqual([
      'sales-zhangsan',
      'maintenance-lisi',
      'finance-wangwu',
    ]);
    expect(handoff.workflow.handoffs).toEqual([
      expect.objectContaining({ toEmployeeId: 'finance-wangwu', reason: '需要核算退款' }),
    ]);

    const listRes = await app.request('/api/runtime/workflows?tenant=tenant-a&actorId=user-sales');
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      workflows: [expect.objectContaining({ id: 'workflow-quote-1', sessionId: 'tenant-a:workflow:workflow-quote-1' })],
    });

    const sessionsRes = await app.request('/api/runtime/sessions?tenant=tenant-a&mode=workflow_group');
    expect(sessionsRes.status).toBe(200);
    expect(await sessionsRes.json()).toEqual({
      sessions: [expect.objectContaining({ id: 'tenant-a:workflow:workflow-quote-1', mode: 'workflow_group' })],
    });

    const messageRes = await app.request('/api/runtime/workflows/workflow-quote-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetEmployeeId: 'finance-wangwu',
        text: '请核算退款额度',
      }),
    });
    expect(messageRes.status).toBe(200);
    const message = await messageRes.json() as { reply: string; session: { id: string; employeeId: string; mode: string } };
    expect(message.reply).toBe('finance-wangwu handled workflow:workflow-quote-1: 请核算退款额度');
    expect(message.session).toEqual(expect.objectContaining({
      id: 'tenant-a:workflow:workflow-quote-1',
      employeeId: 'sales-zhangsan',
      mode: 'workflow_group',
    }));
    expect(agentFactory.respond).toHaveBeenCalledWith(
      '请核算退款额度',
      'workflow:workflow-quote-1',
      'finance-wangwu',
      expect.objectContaining({
        tenant: 'tenant-a',
        userId: 'user-sales',
      }),
    );
    expect(store.listMessagesForSession('tenant-a:workflow:workflow-quote-1').map((item) => ({
      source: item.source,
      employeeId: item.employeeId,
      text: item.text,
    }))).toEqual([
      { source: 'user', employeeId: 'finance-wangwu', text: '请核算退款额度' },
      { source: 'bot', employeeId: 'finance-wangwu', text: 'finance-wangwu handled workflow:workflow-quote-1: 请核算退款额度' },
    ]);
  });
});
