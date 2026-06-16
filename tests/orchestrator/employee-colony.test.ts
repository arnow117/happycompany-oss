import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoadedEmployee } from '../../src/orchestrator/employee-loader.js';
import type { ClaudeAgent } from '../../src/agent.js';
import { EmployeeManager, type EmployeeManagerDeps } from '../../src/orchestrator/employee-colony.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnterprisePeopleStore } from '../../src/enterprise-people.js';

function makeLoadedEmployee(overrides: Partial<LoadedEmployee> = {}): LoadedEmployee {
  return {
    id: 'test-app',
    displayName: 'Test App',
    description: '',
    model: '',
    systemPrompt: '',
    maxTurns: 50,
    tools: [],
    skills: [],
    workspace: '',
    role: 'sales',
    allowedTargets: [],
    tenantName: 'acme',
    filePath: '/corp/acme/apps/test-app.yaml',
    loadedAtMs: Date.now(),
    ...overrides,
  };
}

function makeMockAgent(respondText: string | string[] = 'response'): ClaudeAgent {
  const respond = vi.fn();
  if (Array.isArray(respondText)) {
    for (const text of respondText) {
      respond.mockResolvedValueOnce(text);
    }
    respond.mockResolvedValue(respondText[respondText.length - 1] ?? 'response');
  } else {
    respond.mockResolvedValue(respondText);
  }

  return {
    respond,
  } as unknown as ClaudeAgent;
}

function makeDeps(overrides: Partial<EmployeeManagerDeps> = {}): EmployeeManagerDeps {
  return {
    createAgent: vi.fn().mockReturnValue(makeMockAgent()),
    skillBridge: {
      buildMcpServer: vi.fn().mockReturnValue({
        name: 'skill-tools:test-app',
        version: '1.0.0',
      }),
    },
    skillRunner: {
      buildEmployeeMcpServer: vi.fn().mockReturnValue({
        name: 'employee-platform:test-app',
        version: '1.0.0',
      }),
      listAvailableCommands: vi.fn().mockReturnValue([]),
    },
    corpDir: '/corp',
    dataDir: '/data',
    globalModel: 'claude-sonnet-4-6',
    ...overrides,
  } as unknown as EmployeeManagerDeps;
}

describe('EmployeeManager', () => {
  let colony: EmployeeManager;
  let deps: EmployeeManagerDeps;

  beforeEach(() => {
    deps = makeDeps();
    colony = new EmployeeManager(deps);
  });

  it('register creates a RegisteredEmployee with ClaudeAgent and AgentProtocol', () => {
    const app = makeLoadedEmployee();
    const result = colony.register(app);
    expect(result.app).toBe(app);
    expect(result.agent).toBeDefined();
    expect(result.protocol).toBeDefined();
    expect(result.protocol.name).toBe('test-app');
  });

  it('register calls createAgent with correct options', () => {
    const app = makeLoadedEmployee({ id: 'my-app', model: 'claude-opus-4-7' });
    colony.register(app);
    expect(deps.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-app',
        model: 'claude-sonnet-4-6',
      }),
    );
  });

  it('registerAll creates multiple agents', () => {
    const apps = [makeLoadedEmployee({ id: 'app1' }), makeLoadedEmployee({ id: 'app2' })];
    const results = colony.registerAll(apps);
    expect(results).toHaveLength(2);
    expect(colony.getAppIds()).toEqual(['app1', 'app2']);
  });

  it('get returns registered agent or undefined', () => {
    expect(colony.get('test-app')).toBeUndefined();
    colony.register(makeLoadedEmployee());
    expect(colony.get('test-app')).toBeDefined();
    expect(colony.get('nonexistent')).toBeUndefined();
  });

  it('remove unregisters an agent', () => {
    colony.register(makeLoadedEmployee());
    expect(colony.has('test-app')).toBe(true);
    colony.remove('test-app');
    expect(colony.has('test-app')).toBe(false);
  });

  it('remove returns true when agent exists, false otherwise', () => {
    expect(colony.remove('nonexistent')).toBe(false);
    colony.register(makeLoadedEmployee());
    expect(colony.remove('test-app')).toBe(true);
  });

  it('getAppIds returns all registered app ids', () => {
    colony.registerAll([makeLoadedEmployee({ id: 'a' }), makeLoadedEmployee({ id: 'b' }), makeLoadedEmployee({ id: 'c' })]);
    expect(colony.getAppIds().sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps same employee id isolated across tenants', () => {
    const acmeSales = makeLoadedEmployee({ id: 'sales', tenantName: 'acme', displayName: '示例医疗销售' });
    const acmeMedSales = makeLoadedEmployee({ id: 'sales', tenantName: 'acme-med', displayName: 'Acme 销售' });

    colony.registerAll([acmeSales, acmeMedSales]);

    expect(colony.getEmployees()).toHaveLength(2);
    expect(colony.get('sales', 'acme')?.app.displayName).toBe('示例医疗销售');
    expect(colony.get('sales', 'acme-med')?.app.displayName).toBe('Acme 销售');
    expect(colony.has('sales', 'acme')).toBe(true);
    expect(colony.has('sales', 'acme-med')).toBe(true);
  });

  it('has checks registration status', () => {
    expect(colony.has('test-app')).toBe(false);
    colony.register(makeLoadedEmployee());
    expect(colony.has('test-app')).toBe(true);
  });

  it('getProtocols returns AgentProtocol adapters for all agents', () => {
    colony.registerAll([makeLoadedEmployee({ id: 'a' }), makeLoadedEmployee({ id: 'b' })]);
    const protocols = colony.getProtocols();
    expect(protocols).toHaveLength(2);
    expect(protocols.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });

  it('getAgent returns the ClaudeAgent for a registered app', () => {
    const mockAgent = makeMockAgent();
    deps.createAgent = vi.fn().mockReturnValue(mockAgent);
    colony = new EmployeeManager(deps);
    colony.register(makeLoadedEmployee());
    expect(colony.getAgent('test-app')).toBe(mockAgent);
  });

  it('getAgent returns undefined for unregistered app', () => {
    expect(colony.getAgent('nonexistent')).toBeUndefined();
  });

  it('getAppMcpServer returns MCP server with resolved tools', () => {
    const app = makeLoadedEmployee();
    colony.register(app);
    const server = colony.getAppMcpServer('test-app', { agentId: 'test-app', role: 'sales' });
    expect(server).toBeDefined();
    expect(deps.skillBridge.buildMcpServer).toHaveBeenCalledWith(
      app,
      'acme',
      { agentId: 'test-app', role: 'sales' },
    );
  });

  it('getAppMcpServer returns undefined for unregistered app', () => {
    expect(colony.getAppMcpServer('nonexistent', { agentId: 'x', role: 'y' })).toBeUndefined();
  });

  it('uses globalModel as the runtime platform override when set', () => {
    const app = makeLoadedEmployee({ model: 'claude-opus-4-7' });
    colony.register(app);
    expect(deps.createAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-4-6' }));
  });

  it('falls back to app.model when no globalModel is configured', () => {
    const localDeps = makeDeps({ globalModel: undefined });
    const localColony = new EmployeeManager(localDeps);
    const app = makeLoadedEmployee({ model: 'claude-opus-4-7' });
    localColony.register(app);
    expect(localDeps.createAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-4-7' }));
  });

  it('resolves workspace path correctly', () => {
    const app = makeLoadedEmployee({ id: 'my-app', workspace: 'workdir/my-app' });
    colony.register(app);
    expect(deps.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDir: '/corp/acme/workdir/my-app',
        cwd: '/corp/acme/workdir/my-app',
      }),
    );
  });

  it('uses default workspace when app.workspace is empty', () => {
    const app = makeLoadedEmployee({ id: 'my-app', workspace: '' });
    colony.register(app);
    expect(deps.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDir: '/corp/acme/agents/my-app',
        cwd: '/corp/acme/agents/my-app',
      }),
    );
  });

  it('resolves personal assistant from enterprise people binding', () => {
    const corpDir = mkdtempSync(join(tmpdir(), 'employee-manager-people-'));
    try {
      const people = new EnterprisePeopleStore(corpDir);
      people.sync('acme', [
        { userId: 'ding-user-1', name: '赵六', departments: [{ id: '1', name: '示例医疗' }] },
      ]);
      people.bindAssistant('acme', 'ding-user-1', { role: 'sales', assistantId: 'sales-zhangsan' });

      const deps = makeDeps({ corpDir });
      const colony = new EmployeeManager(deps);
      colony.register(makeLoadedEmployee({ id: 'sales-zhangsan', tenantName: 'acme' }));

      expect(colony.findByHumanUserId('acme', 'ding-user-1')).toBe('sales-zhangsan');
    } finally {
      rmSync(corpDir, { recursive: true, force: true });
    }
  });

  it('routes among multiple role assistants for the same human user', () => {
    const corpDir = mkdtempSync(join(tmpdir(), 'employee-manager-role-bindings-'));
    try {
      const people = new EnterprisePeopleStore(corpDir);
      people.sync('acme', [
        { userId: 'ding-user-2', name: '温瀚翔', departments: [{ id: '1', name: '示例医疗' }] },
      ]);
      people.bindRoleAssistants('acme', 'ding-user-2', [
        { role: 'sales', assistantId: 'sales-zhangsan' },
        { role: 'maintenance', assistantId: 'maintenance-lisi' },
        { role: 'finance', assistantId: 'finance-wangwu' },
      ]);

      const deps = makeDeps({ corpDir });
      const colony = new EmployeeManager(deps);
      colony.registerAll([
        makeLoadedEmployee({ id: 'sales-zhangsan', role: 'sales', capabilities: ['销售', '合同签署'], tenantName: 'acme' }),
        makeLoadedEmployee({ id: 'maintenance-lisi', role: 'maintenance', capabilities: ['维修', '回执签署'], tenantName: 'acme' }),
        makeLoadedEmployee({ id: 'finance-wangwu', role: 'finance', capabilities: ['财务', '结算', '发票'], tenantName: 'acme' }),
      ]);

      expect(colony.findByHumanUserId('acme', 'ding-user-2', '客户设备需要维修')).toBe('maintenance-lisi');
      expect(colony.findByHumanUserId('acme', 'ding-user-2', '这笔合同需要开票结算')).toBe('finance-wangwu');
      expect(colony.findByHumanUserId('acme', 'ding-user-2', '客户合同销售跟进')).toBe('sales-zhangsan');
    } finally {
      rmSync(corpDir, { recursive: true, force: true });
    }
  });
});

describe('ClaudeAgentAdapter', () => {
  it('calls agent.respond and parses handoff', async () => {
    const handoffJson = JSON.stringify({
      type: 'handoff_request',
      target_agent: 'sales-mgr',
      payload: { event: 'approve discount' },
    });
    const mockAgent = makeMockAgent(`Done. ${handoffJson}`);

    const deps = makeDeps();
    deps.createAgent = vi.fn().mockReturnValue(mockAgent);
    const colony = new EmployeeManager(deps);
    const app = makeLoadedEmployee();
    const { protocol } = colony.register(app);

    const response = await protocol.execute('Approve this discount');
    expect(response.text).toContain('Done');
    expect(response.handoff).not.toBeNull();
    expect(response.handoff?.targetAgent).toBe('sales-mgr');
    expect(response.done).toBe(false);
    expect(mockAgent.respond).toHaveBeenCalledWith(
      expect.stringContaining('Approve this discount'),
      '__orchestrator__',
      expect.objectContaining({
        onToolStart: expect.any(Function),
        mcpServers: expect.objectContaining({ 'employee-platform': expect.any(Object) }),
        tools: [],
      }),
    );
  });

  it('returns done=true when no handoff in response', async () => {
    const mockAgent = makeMockAgent('Task completed successfully.');
    const deps = makeDeps();
    deps.createAgent = vi.fn().mockReturnValue(mockAgent);
    const colony = new EmployeeManager(deps);
    const { protocol } = colony.register(makeLoadedEmployee());

    const response = await protocol.execute('Do something');
    expect(response.handoff).toBeNull();
    expect(response.done).toBe(true);
  });

  it('passes chatId from context to agent.respond', async () => {
    const mockAgent = makeMockAgent('ok');
    const deps = makeDeps();
    deps.createAgent = vi.fn().mockReturnValue(mockAgent);
    const colony = new EmployeeManager(deps);
    const { protocol } = colony.register(makeLoadedEmployee());

    await protocol.execute('test', { chatId: 'chat-123' });
    expect(mockAgent.respond).toHaveBeenCalledWith(
      expect.stringContaining('test'),
      'chat-123',
      expect.objectContaining({ onToolStart: expect.any(Function) }),
    );
  });

  it('passes employee-scoped platform tools and skills during orchestration execution', async () => {
    const mockAgent = makeMockAgent('ok');
    const platformMcpServer = {
      name: 'employee-platform:sales-zhangsan',
      version: '1.0.0',
      instance: {},
    };
    const skillRunner = {
      buildEmployeeMcpServer: vi.fn().mockReturnValue(platformMcpServer),
      listAvailableCommands: vi.fn().mockReturnValue([
        { skillName: 'med_crm', appName: 'med_crm', name: 'search_hospitals', description: 'search hospitals' },
      ]),
    } as unknown as EmployeeManagerDeps['skillRunner'];
    const deps = makeDeps({
      createAgent: vi.fn().mockReturnValue(mockAgent),
      skillRunner,
    });
    const colony = new EmployeeManager(deps);
    const { protocol } = colony.register(makeLoadedEmployee({
      id: 'sales-zhangsan',
      role: 'sales',
      skills: ['med_crm'],
      tools: ['med_crm:search_hospitals'],
    }));

    await protocol.execute('查询合同');

    expect(skillRunner!.buildEmployeeMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sales-zhangsan' }),
    );
    expect(mockAgent.respond).toHaveBeenCalledWith(
      expect.stringContaining('查询合同'),
      '__orchestrator__',
      expect.objectContaining({
        tools: [],
        mcpServers: { 'employee-platform': platformMcpServer },
        skills: ['med_crm'],
      }),
    );
    expect((mockAgent.respond as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('med_crm.search_hospitals');
  });

  it('does not duplicate long-term employee systemPrompt in the runtime user prompt', async () => {
    const mockAgent = makeMockAgent('ok');
    const deps = makeDeps({ createAgent: vi.fn().mockReturnValue(mockAgent) });
    const colony = new EmployeeManager(deps);
    const { protocol } = colony.register(makeLoadedEmployee({
      systemPrompt: '这段长期说明应该由 CLAUDE.md 注入',
    }));

    await protocol.execute('处理一个客户问题');

    const runtimePrompt = (mockAgent.respond as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(runtimePrompt).toContain('处理一个客户问题');
    expect(runtimePrompt).toContain('长期员工说明已通过 workspace/CLAUDE.md');
    expect(runtimePrompt).not.toContain('这段长期说明应该由 CLAUDE.md 注入');
  });

  it('instructs employees to finish their own authorized work before handoff', async () => {
    const mockAgent = makeMockAgent('ok');
    const deps = makeDeps({ createAgent: vi.fn().mockReturnValue(mockAgent) });
    const colony = new EmployeeManager(deps);
    const { protocol } = colony.register(makeLoadedEmployee({
      id: 'sales-zhangsan',
      role: 'sales',
      skills: ['med_crm'],
      tools: ['med_crm:global_search'],
      allowedTargets: ['finance-wangwu'],
    }));

    await protocol.execute('客户要确认设备维保状态和开票安排');

    const runtimePrompt = (mockAgent.respond as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(runtimePrompt).toContain('协同规则');
    expect(runtimePrompt).toContain('先完成自己职责和已授权工具能处理的查询');
    expect(runtimePrompt).toContain('不要把自己已授权可查的数据转交给其他员工代查');
    expect(runtimePrompt).toContain('缺少客户、设备、合同等必要线索，直接向用户追问');
    expect(runtimePrompt).toContain('可交接目标员工 ID');
    expect(runtimePrompt).toContain('- finance-wangwu');
    expect(runtimePrompt).toContain('禁止只用自然语言声称');
    expect(runtimePrompt).toContain('不要翻译或编造 ID');
  });

  it('retries once when the agent claims a handoff without calling the tool', async () => {
    const handoffJson = JSON.stringify({
      type: 'handoff_request',
      target_agent: 'maintenance-lisi',
      payload: { event: '请维修李四确认测试合同执行信息' },
    });
    const mockAgent = makeMockAgent([
      '已 handoff 给维修李四（repair-lisi），等待对方回复。',
      `改为真实 handoff。${handoffJson}`,
    ]);
    const deps = makeDeps({ createAgent: vi.fn().mockReturnValue(mockAgent) });
    const colony = new EmployeeManager(deps);
    const { protocol } = colony.register(makeLoadedEmployee({
      id: 'sales-zhangsan',
      role: 'sales',
      allowedTargets: ['maintenance-lisi'],
    }));

    const response = await protocol.execute('把测试合同交接给维修');

    expect(response.handoff?.targetAgent).toBe('maintenance-lisi');
    expect(response.done).toBe(false);
    expect(response.data.fakeHandoffCorrected).toBe(true);
    expect(mockAgent.respond).toHaveBeenCalledTimes(2);
    const retryPrompt = (mockAgent.respond as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(retryPrompt).toContain('平台没有检测到 handoff tool 调用');
    expect(retryPrompt).toContain('target 必须来自可交接目标员工 ID');
  });

  it('blocks a fake handoff when retry still does not produce a real handoff', async () => {
    const mockAgent = makeMockAgent([
      '已转交给维修李四，等待回复。',
      '我再次确认，已经转交给维修李四。',
    ]);
    const deps = makeDeps({ createAgent: vi.fn().mockReturnValue(mockAgent) });
    const colony = new EmployeeManager(deps);
    const { protocol } = colony.register(makeLoadedEmployee({
      id: 'sales-zhangsan',
      role: 'sales',
      allowedTargets: ['maintenance-lisi'],
    }));

    const response = await protocol.execute('把测试合同交接给维修');

    expect(response.handoff).toBeNull();
    expect(response.done).toBe(true);
    expect(response.text).toContain('平台没有收到真实的 handoff 工具调用');
    expect(response.data.fakeHandoffBlocked).toBe(true);
    expect(mockAgent.respond).toHaveBeenCalledTimes(2);
  });

});
