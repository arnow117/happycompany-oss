import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { MessageBus } from '../../src/bus.js';
import { ContractStore } from '../../src/orchestrator/contract-store.js';
import { ContractChainTracker, InMemoryChainStore } from '../../src/orchestrator/contract-chain.js';
import { EmployeeManager } from '../../src/orchestrator/employee-colony.js';
import { PMOOrchestratorRunner } from '../../src/orchestrator/orchestrator-runner.js';
import { SkillBridge } from '../../src/orchestrator/skill-bridge.js';
import { TraceStore } from '../../src/orchestrator/trace-store.js';
import type { AgentOptions, ClaudeAgent } from '../../src/agent.js';
import type { LoadedEmployee } from '../../src/orchestrator/employee-loader.js';
import { AppServerMgr } from '../../src/app-server.js';
import type { ToolRegistry } from '../../src/tool-registry.js';

class FakeClaudeAgent {
  constructor(private readonly name: string) {}

  async respond(input: string): Promise<string> {
    if (this.name === 'maintenance-lisi') {
      return `维修李四已接收: ${input}`;
    }
    return `直接回答: ${input}`;
  }
}

class CapturingClaudeAgent {
  readonly calls: Array<{ input: string; chatId: string }> = [];

  async respond(input: string, chatId: string): Promise<string> {
    this.calls.push({ input, chatId });
    return `直接回答: ${input}`;
  }
}

class HandoffFlowClaudeAgent {
  private salesCalls = 0;

  constructor(private readonly name: string) {}

  async respond(input: string): Promise<string> {
    if (this.name === 'sales-zhangsan') {
      this.salesCalls += 1;
      if (this.salesCalls === 1) {
        return JSON.stringify({
          type: 'handoff_request',
          target_agent: 'maintenance-lisi',
          payload: {
            event: '请确认设备维保执行条件',
            context: { customer: '浙大一院' },
          },
        });
      }
      return `销售汇总已收到子任务结果: ${input}`;
    }
    if (this.name === 'maintenance-lisi') {
      return '维修李四确认：测试维保条件完整。';
    }
    return `直接回答: ${input}`;
  }
}

function employee(partial: Partial<LoadedEmployee> & Pick<LoadedEmployee, 'id'>): LoadedEmployee {
  return {
    id: partial.id,
    displayName: partial.displayName ?? partial.id,
    description: partial.description ?? '',
    model: partial.model ?? 'glm-5-turbo',
    systemPrompt: partial.systemPrompt ?? '',
    maxTurns: partial.maxTurns ?? 50,
    tools: partial.tools ?? [],
    skills: partial.skills ?? [],
    workspace: partial.workspace ?? '',
    role: partial.role ?? '',
    allowedTargets: partial.allowedTargets ?? [],
    capabilities: partial.capabilities ?? [],
    source: partial.source ?? 'prepopulated',
    createdAt: partial.createdAt ?? 1,
    tenantName: partial.tenantName ?? 'acme',
    filePath: partial.filePath ?? `/tmp/${partial.id}.yaml`,
    loadedAtMs: partial.loadedAtMs ?? 1,
  };
}

describe('PMOOrchestratorRunner', () => {
  it('routes via employee with allowedTargets to matched employee', async () => {
    const db = new Database(':memory:');
    const traceStore = new TraceStore();
    const manager = new EmployeeManager({
      globalModel: 'glm-5-turbo',
      createAgent: (opts: AgentOptions) => new FakeClaudeAgent(opts.name) as unknown as ClaudeAgent,
      skillBridge: new SkillBridge({
        toolRegistry: { getToolsForTenant: vi.fn().mockReturnValue([]) } as unknown as ToolRegistry,
        appServerMgr: new AppServerMgr(),
        corpDir: '/tmp/corp',
      }),
      corpDir: '/tmp/corp',
      dataDir: '/tmp/data',
    });

    manager.registerAll([
      employee({
        id: 'sales-zhangsan',
        displayName: '销售张三',
        description: '负责客户跟进和合同签署',
        role: 'sales',
        capabilities: ['销售', '客户跟进', '合同签署'],
        allowedTargets: ['maintenance-lisi'],
      }),
      employee({
        id: 'maintenance-lisi',
        displayName: '维修李四',
        description: '负责合同执行、现场维修与回执签署',
        role: 'maintenance',
        capabilities: ['维修', '工单', '故障诊断', '回执签署'],
      }),
    ]);

    const runner = new PMOOrchestratorRunner({
      employeeManager: manager,
      chainTracker: new ContractChainTracker(new InMemoryChainStore()),
      bus: new MessageBus(),
      contractStore: new ContractStore(db),
      traceStore,
      directorEnabled: false,
    });

    const handoffs: Array<{ from: string; to: string; reason?: string }> = [];
    const result = await runner.run('如果我是示例医疗员工，设备维修问题该找谁？', 'sales-zhangsan', {
      onHandoff: (info) => handoffs.push(info),
    });

    expect(result.success).toBe(true);
    expect(result.summary).toContain('维修李四已接收');
    expect(result.history.route).toEqual(['sales-zhangsan->maintenance-lisi']);
    expect(result.history.handoffCount).toBe(1);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toMatchObject({
      from: 'sales-zhangsan',
      to: 'maintenance-lisi',
    });

    const [trace] = traceStore.list();
    expect(trace.entryAgent).toBe('sales-zhangsan');
    expect(trace.route).toEqual(['sales-zhangsan->maintenance-lisi']);
    expect(trace.handoffCount).toBe(1);
    expect(trace.steps[0]).toMatchObject({
      from: 'sales-zhangsan',
      to: 'maintenance-lisi',
      action: 'auto_route',
      task: '如果我是示例医疗员工，设备维修问题该找谁？',
    });
    expect(trace.steps[0].reason).toContain('维修李四');
    expect(trace.steps[0].reason).toContain('维修');

    db.close();
  });

  it('can keep a selected entry employee from pre-routing immediately', async () => {
    const db = new Database(':memory:');
    const manager = new EmployeeManager({
      globalModel: 'glm-5-turbo',
      createAgent: (opts: AgentOptions) => new FakeClaudeAgent(opts.name) as unknown as ClaudeAgent,
      skillBridge: new SkillBridge({
        toolRegistry: { getToolsForTenant: vi.fn().mockReturnValue([]) } as unknown as ToolRegistry,
        appServerMgr: new AppServerMgr(),
        corpDir: '/tmp/corp',
      }),
      corpDir: '/tmp/corp',
      dataDir: '/tmp/data',
    });

    manager.registerAll([
      employee({
        id: 'sales-zhangsan',
        displayName: '销售张三',
        description: '负责客户跟进和合同签署',
        role: 'sales',
        capabilities: ['销售', '客户跟进', '合同签署'],
        allowedTargets: ['finance-wangwu'],
      }),
      employee({
        id: 'finance-wangwu',
        displayName: '财务王五',
        description: '负责合同管理与结算',
        role: 'finance',
        capabilities: ['财务', '合同管理', '结算'],
      }),
    ]);

    const runner = new PMOOrchestratorRunner({
      employeeManager: manager,
      chainTracker: new ContractChainTracker(new InMemoryChainStore()),
      bus: new MessageBus(),
      contractStore: new ContractStore(db),
      directorEnabled: false,
    });

    const result = await runner.run('查一下浙一医院相关设备/合同', 'sales-zhangsan', { preRoute: false });

    expect(result.success).toBe(true);
    expect(result.summary).toContain('直接回答');
    expect(result.history.route).not.toEqual(['sales-zhangsan->finance-wangwu']);

    db.close();
  });

  it('uses the web chat id as the orchestration agent session id', async () => {
    const db = new Database(':memory:');
    const salesAgent = new CapturingClaudeAgent();
    const manager = new EmployeeManager({
      globalModel: 'glm-5-turbo',
      createAgent: () => salesAgent as unknown as ClaudeAgent,
      skillBridge: new SkillBridge({
        toolRegistry: { getToolsForTenant: vi.fn().mockReturnValue([]) } as unknown as ToolRegistry,
        appServerMgr: new AppServerMgr(),
        corpDir: '/tmp/corp',
      }),
      corpDir: '/tmp/corp',
      dataDir: '/tmp/data',
    });

    manager.register(employee({
      id: 'sales-zhangsan',
      displayName: '销售张三',
      role: 'sales',
      capabilities: ['销售'],
      allowedTargets: ['finance-wangwu'],
    }));

    const runner = new PMOOrchestratorRunner({
      employeeManager: manager,
      chainTracker: new ContractChainTracker(new InMemoryChainStore()),
      bus: new MessageBus(),
      contractStore: new ContractStore(db),
      directorEnabled: false,
    });

    await runner.respond('继续上一件事', 'web-bot-1780410667294', 'sales-zhangsan', {
      preRoute: false,
    });

    expect(salesAgent.calls[0]?.chatId).toBe('web-bot-1780410667294');

    db.close();
  });

  it('publishes delegated child results as chat stream events', async () => {
    const db = new Database(':memory:');
    const bus = new MessageBus();
    const manager = new EmployeeManager({
      globalModel: 'glm-5-turbo',
      createAgent: (opts: AgentOptions) => new HandoffFlowClaudeAgent(opts.name) as unknown as ClaudeAgent,
      skillBridge: new SkillBridge({
        toolRegistry: { getToolsForTenant: vi.fn().mockReturnValue([]) } as unknown as ToolRegistry,
        appServerMgr: new AppServerMgr(),
        corpDir: '/tmp/corp',
      }),
      corpDir: '/tmp/corp',
      dataDir: '/tmp/data',
    });

    manager.registerAll([
      employee({
        id: 'sales-zhangsan',
        displayName: '销售张三',
        role: 'sales',
        allowedTargets: ['maintenance-lisi'],
      }),
      employee({
        id: 'maintenance-lisi',
        displayName: '维修李四',
        role: 'maintenance',
      }),
    ]);

    const runner = new PMOOrchestratorRunner({
      employeeManager: manager,
      chainTracker: new ContractChainTracker(new InMemoryChainStore()),
      bus,
      contractStore: new ContractStore(db),
      directorEnabled: false,
    });

    const summary = await runner.respond('测试销售到维修交接', 'chat-handoff-result', 'sales-zhangsan', {
      preRoute: false,
    });

    expect(summary).toContain('维修李四确认');
    expect(bus.snapshot()).toContainEqual(expect.objectContaining({
      type: 'stream_event',
      botName: 'sales-zhangsan',
      chatId: 'chat-handoff-result',
      event: expect.objectContaining({
        eventType: 'handoff_result',
        handoffTo: 'maintenance-lisi',
        handoffStatus: 'completed',
        handoffResult: '维修李四确认：测试维保条件完整。',
      }),
    }));

    db.close();
  });
});
