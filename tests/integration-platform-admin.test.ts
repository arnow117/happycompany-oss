import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmployeeLoader } from '../src/orchestrator/employee-loader.js';
import { EmployeeManager, type EmployeeManagerDeps } from '../src/orchestrator/employee-colony.js';
import { SkillBridge } from '../src/orchestrator/skill-bridge.js';
import type { ToolRegistry } from '../src/tool-registry.js';
import type { AppServerMgr } from '../src/app-server.js';
import type { ClaudeAgent } from '../src/agent.js';

// Self-contained fixture: the admin-workplace employee is materialized into a
// temp corpDir so this integration test is portable and never reaches into a
// real customer tenant on the host filesystem.
const TENANT = 'acme-demo';
const ADMIN_WORKPLACE_YAML = `id: admin-workplace
displayName: 行政工位专员
description: 负责办公地点、门禁、办公用品和 HR 入职协调。
model: deepseek-v4-flash
systemPrompt: |
  你是企业行政工位专员，负责办公地点安排、门禁权限、办公用品申领和 HR 入职协调。
maxTurns: 50
workspace: agents/admin-workplace
role: admin-workplace
source: prepopulated
createdAt: 1716374400000
`;

let corpDir: string;
let dataDir: string;

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'hc-admin-'));
  corpDir = join(root, 'corp');
  dataDir = join(root, 'data');
  const employeesDir = join(corpDir, TENANT, 'employees');
  mkdirSync(employeesDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(employeesDir, 'admin-workplace.yaml'), ADMIN_WORKPLACE_YAML);
});

afterAll(() => {
  if (corpDir) rmSync(join(corpDir, '..'), { recursive: true, force: true });
});

function makeToolRegistry(): ToolRegistry {
  return {
    getToolsForTenant: vi.fn().mockReturnValue([]),
    lookup: vi.fn(),
    getSkillSummaries: vi.fn().mockReturnValue([]),
    getAllTenantNames: vi.fn().mockReturnValue([TENANT]),
  } as unknown as ToolRegistry;
}

function makeAppServerMgr(): AppServerMgr {
  return {
    call: vi.fn().mockResolvedValue({ results: [] }),
    callCli: vi.fn().mockResolvedValue({ results: [] }),
    getServerStatus: vi.fn().mockReturnValue({ running: false }),
  } as unknown as AppServerMgr;
}

function makeMockAgent(respondText: string = 'ok'): ClaudeAgent {
  return {
    respond: vi.fn().mockResolvedValue(respondText),
  } as unknown as ClaudeAgent;
}

describe('Tenant Admin Workplace Integration', () => {
  it('loads admin-workplace.yaml from current tenant employees', () => {
    const loader = new EmployeeLoader({ corpDir });
    const apps = loader.loadTenant(TENANT);

    const adminWorkplace = apps.find((app) => app.id === 'admin-workplace');
    expect(adminWorkplace).toBeDefined();
    expect(adminWorkplace!.id).toBe('admin-workplace');
    expect(adminWorkplace!.displayName).toBe('行政工位专员');
    expect(adminWorkplace!.role).toBe('admin-workplace');
    expect(adminWorkplace!.model).toBe('deepseek-v4-flash');
    expect(adminWorkplace!.workspace).toBe('agents/admin-workplace');
    expect(adminWorkplace!.tenantName).toBe(TENANT);
  });

  it('registers admin-workplace agent in colony', () => {
    const loader = new EmployeeLoader({ corpDir });
    const apps = loader.loadTenant(TENANT);
    const adminWorkplace = apps.find((app) => app.id === 'admin-workplace');
    expect(adminWorkplace).toBeDefined();

    const toolRegistry = makeToolRegistry();
    const appServerMgr = makeAppServerMgr();
    const skillBridge = new SkillBridge({ toolRegistry, appServerMgr, corpDir });

    const deps: EmployeeManagerDeps = {
      globalModel: 'claude-sonnet-4-6',
      skillBridge,
      corpDir,
      dataDir,
      createAgent: vi.fn().mockReturnValue(makeMockAgent()),
    } as unknown as EmployeeManagerDeps;

    const colony = new EmployeeManager(deps);
    colony.register(adminWorkplace!);

    expect(colony.has('admin-workplace', TENANT)).toBe(true);
  });

  it('admin-workplace agent can be retrieved from colony', () => {
    const loader = new EmployeeLoader({ corpDir });
    const apps = loader.loadTenant(TENANT);
    const adminWorkplace = apps.find((app) => app.id === 'admin-workplace');
    expect(adminWorkplace).toBeDefined();

    const toolRegistry = makeToolRegistry();
    const appServerMgr = makeAppServerMgr();
    const skillBridge = new SkillBridge({ toolRegistry, appServerMgr, corpDir });

    const deps: EmployeeManagerDeps = {
      globalModel: 'claude-sonnet-4-6',
      skillBridge,
      corpDir,
      dataDir,
      createAgent: vi.fn().mockReturnValue(makeMockAgent()),
    } as unknown as EmployeeManagerDeps;

    const colony = new EmployeeManager(deps);
    colony.register(adminWorkplace!);

    const agent = colony.get('admin-workplace', TENANT);
    expect(agent).toBeDefined();
    expect(agent!.app.id).toBe('admin-workplace');
    expect(agent!.app.role).toBe('admin-workplace');
  });

  it('admin-workplace system prompt explains workplace responsibilities', () => {
    const loader = new EmployeeLoader({ corpDir });
    const apps = loader.loadTenant(TENANT);
    const adminWorkplace = apps.find((app) => app.id === 'admin-workplace');
    expect(adminWorkplace).toBeDefined();

    const prompt = adminWorkplace!.systemPrompt;
    expect(prompt).toContain('企业行政工位专员');
    expect(prompt).toContain('办公地点');
    expect(prompt).toContain('门禁');
    expect(prompt).toContain('办公用品');
    expect(prompt).toContain('HR 入职协调');
  });
});
