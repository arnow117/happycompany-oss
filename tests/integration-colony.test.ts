import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoadedEmployee } from '../src/orchestrator/employee-loader.js';
import type { ClaudeAgent } from '../src/agent.js';
import type { ToolRegistry } from '../src/tool-registry.js';
import type { AppServerMgr } from '../src/app-server.js';
import type { RegisteredTool } from '../src/types.js';
import { EmployeeManager, type EmployeeManagerDeps } from '../src/orchestrator/employee-colony.js';
import { SkillBridge, type CallerContext } from '../src/orchestrator/skill-bridge.js';

function makeLoadedEmployee(overrides: Partial<LoadedEmployee> = {}): LoadedEmployee {
  return {
    id: 'colony-bot',
    displayName: 'Colony Bot',
    description: '',
    model: '',
    systemPrompt: '',
    maxTurns: 50,
    tools: ['med_crm:search_hospitals'],
    skills: [],
    workspace: '',
    role: 'sales',
    allowedTargets: [],
    tenantName: 'acme',
    filePath: '/corp/acme/employees/colony-bot.yaml',
    loadedAtMs: Date.now(),
    ...overrides,
  };
}

function makeMockAgent(respondText: string = 'ok'): ClaudeAgent {
  return {
    respond: vi.fn().mockResolvedValue(respondText),
  } as unknown as ClaudeAgent;
}

function makeToolRegistry(): ToolRegistry {
  const tool: RegisteredTool = {
    name: 'search_hospitals',
    description: 'Search hospitals',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    namespacedName: 'med_crm:search_hospitals',
    skillName: 'med_crm',
    skillDir: '/corp/acme/.claude/skills/med_crm',
    appName: 'med_crm',
    tenantName: 'acme',
    hasServer: false,
  };
  return {
    getToolsForTenant: vi.fn().mockReturnValue([tool]),
    lookup: vi.fn().mockReturnValue(tool),
    getSkillSummaries: vi.fn().mockReturnValue([{ name: 'med_crm', displayName: 'Med CRM', description: '', toolCount: 1, hasServer: false }]),
    getAllTenantNames: vi.fn().mockReturnValue(['acme']),
  } as unknown as ToolRegistry;
}

function makeAppServerMgr(): AppServerMgr {
  return {
    call: vi.fn().mockResolvedValue({ results: [] }),
    callCli: vi.fn().mockResolvedValue({ results: [] }),
    getServerStatus: vi.fn().mockReturnValue({ running: false }),
  } as unknown as AppServerMgr;
}

describe('Colony integration', () => {
  let colony: EmployeeManager;
  let skillBridge: SkillBridge;
  let toolRegistry: ToolRegistry;
  let appServerMgr: AppServerMgr;
  let deps: EmployeeManagerDeps;
  const callerContext: CallerContext = { agentId: 'colony-bot', role: 'sales' };

  beforeEach(() => {
    toolRegistry = makeToolRegistry();
    appServerMgr = makeAppServerMgr();
    skillBridge = new SkillBridge({ toolRegistry, appServerMgr, corpDir: '/corp' });
    deps = {
      globalModel: 'claude-sonnet-4-6',
      skillBridge,
      corpDir: '/corp',
      dataDir: '/data',
      createAgent: vi.fn().mockReturnValue(makeMockAgent()),
    } as unknown as EmployeeManagerDeps;
    colony = new EmployeeManager(deps);
  });

  it('colony agent responds when botName matches APP id', async () => {
    const app = makeLoadedEmployee();
    const { protocol } = colony.register(app);
    const response = await protocol.execute('Search for hospitals');
    expect(response.text).toBe('ok');
    expect(response.done).toBe(true);
  });

  it('falls back to config.json bot when no colony match', () => {
    expect(colony.has('config-bot')).toBe(false);
    expect(colony.get('config-bot')).toBeUndefined();
  });

  it('colony agent receives MCP tools from SkillBridge', () => {
    const app = makeLoadedEmployee();
    colony.register(app);
    const server = colony.getAppMcpServer('colony-bot', callerContext);
    expect(server).toBeDefined();
    expect(server!.name).toContain('colony-bot');
    expect(skillBridge['options']?.toolRegistry?.getToolsForTenant).toHaveBeenCalledWith('acme');
  });

  it('SkillBridge resolves tools from correct tenant', () => {
    const app = makeLoadedEmployee();
    const resolved = skillBridge.resolveTools(app, 'acme');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].registered.namespacedName).toBe('med_crm:search_hospitals');
  });

  it('AgentProtocol adapter extracts handoff from response', async () => {
    const handoffJson = JSON.stringify({
      type: 'handoff_request',
      target_agent: 'sales-mgr',
      payload: { event: 'approval needed' },
    });
    const mockAgent = makeMockAgent(`Review complete. ${handoffJson}`);
    deps.createAgent = vi.fn().mockReturnValue(mockAgent);
    const freshColony = new EmployeeManager(deps);
    const { protocol } = freshColony.register(makeLoadedEmployee());

    const response = await protocol.execute('Submit for approval');
    expect(response.handoff).not.toBeNull();
    expect(response.handoff?.targetAgent).toBe('sales-mgr');
    expect(response.done).toBe(false);
  });

  it('colony getProtocols returns adapters for orchestrator', () => {
    colony.register(makeLoadedEmployee({ id: 'a' }));
    colony.register(makeLoadedEmployee({ id: 'b' }));
    const protocols = colony.getProtocols();
    expect(protocols).toHaveLength(2);
    expect(protocols.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });
});
