import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillRunner } from '../../src/orchestrator/skill-runner.js';
import { ToolRegistry } from '../../src/tool-registry.js';
import { MemoryManager } from '../../src/memory.js';
import type { AppServerMgr } from '../../src/app-server.js';
import type { LoadedEmployee } from '../../src/orchestrator/employee-loader.js';

type RegisteredMcpToolForTest = {
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
};

type EmployeeMcpServerForTest = {
  instance: {
    _registeredTools: Record<string, RegisteredMcpToolForTest>;
  };
};

function makeEmployee(overrides: Partial<LoadedEmployee> = {}): LoadedEmployee {
  return {
    id: 'sales-zhangsan',
    displayName: '销售张三',
    description: '',
    model: '',
    systemPrompt: '',
    maxTurns: 50,
    tools: [],
    skills: ['med_crm'],
    workspace: '',
    role: 'sales',
    allowedTargets: [],
    tenantName: 'acme',
    filePath: '/tmp/sales-zhangsan.yaml',
    loadedAtMs: Date.now(),
    ...overrides,
  };
}

function getResultText(result: unknown): string {
  const parsed = result as { content: Array<{ text: string }> };
  return parsed.content[0]?.text ?? '';
}

describe('SkillRunner', () => {
  let corpDir: string;
  let toolRegistry: ToolRegistry;
  let appServerMgr: AppServerMgr;

  beforeEach(() => {
    corpDir = join(tmpdir(), `happycompany-skill-runner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(corpDir, 'acme', '.claude', 'skills', 'med_crm'), { recursive: true });
    writeFileSync(join(corpDir, 'acme', '.claude', 'skills', 'med_crm', 'SKILL.md'), '# med_crm\n', 'utf-8');
    mkdirSync(join(corpDir, 'acme', 'cdata'), { recursive: true });
    writeFileSync(join(corpDir, 'acme', 'cdata', 'crm.db'), '', 'utf-8');
    writeFileSync(
      join(corpDir, 'acme', '.claude', 'skills', 'med_crm', 'tools.json'),
      JSON.stringify({
        name: 'med_crm',
        tools: [
          {
            name: 'global_search',
            description: 'global search',
            riskLevel: 'read',
            parameters: { type: 'object', properties: { keyword: {} }, required: ['keyword'] },
          },
          {
            name: 'add_sales_activity',
            description: 'add activity',
            riskLevel: 'internal_write',
            parameters: { type: 'object', properties: { hospital: {}, summary: {} }, required: ['hospital', 'summary'] },
          },
          {
            name: 'contract_intake',
            description: 'contract intake',
            riskLevel: 'internal_write',
            parameters: {
              type: 'object',
              properties: {
                contractId: {},
                customer: {},
                deviceModel: {},
                servicePeriodStart: {},
                servicePeriodEnd: {},
                maintenanceCycle: {},
              },
              required: ['contractId', 'customer', 'deviceModel', 'servicePeriodStart', 'servicePeriodEnd', 'maintenanceCycle'],
            },
          },
        ],
      }),
      'utf-8',
    );

    toolRegistry = new ToolRegistry(corpDir);
    toolRegistry.scan();
    appServerMgr = {
      callCli: vi.fn().mockResolvedValue({ items: [], query: '浙一' }),
      call: vi.fn().mockResolvedValue({ items: [] }),
      getServerStatus: vi.fn(),
    } as unknown as AppServerMgr;
  });

  afterEach(() => {
    rmSync(corpDir, { recursive: true, force: true });
  });

  it('runs an authorized command for a bound skill', async () => {
    const runner = new SkillRunner({ toolRegistry, appServerMgr, corpDir });
    const result = await runner.run({
      employee: makeEmployee(),
      skill: 'med_crm',
      command: 'global_search',
      args: { keyword: '浙一' },
    });

    expect(result.ok).toBe(true);
    expect(appServerMgr.callCli).toHaveBeenCalledWith(expect.objectContaining({
      cwd: realpathSync(join(corpDir, 'acme', '.claude', 'skills', 'med_crm')),
      command: 'python3',
      args: ['-m', 'med_crm.cli', 'global_search', '--keyword', '浙一'],
      env: { ACME_CRM_DB: join(corpDir, 'acme', 'cdata', 'crm.db') },
    }));
  });

  it('accepts namespaced command names from LLM tool calls', async () => {
    const runner = new SkillRunner({ toolRegistry, appServerMgr, corpDir });
    const result = await runner.run({
      employee: makeEmployee(),
      skill: 'med_crm',
      command: 'med_crm:global_search',
      args: { keyword: '浙一' },
    });

    expect(result.ok).toBe(true);
    expect(appServerMgr.callCli).toHaveBeenCalledWith(expect.objectContaining({
      args: ['-m', 'med_crm.cli', 'global_search', '--keyword', '浙一'],
    }));
  });

  it('passes contract intake fields to CLI using kebab-case arguments', async () => {
    const runner = new SkillRunner({ toolRegistry, appServerMgr, corpDir });
    const result = await runner.run({
      employee: makeEmployee(),
      skill: 'med_crm',
      command: 'contract_intake',
      args: {
        contractId: 'jsrm-540ct-full-service',
        customer: '江山市人民医院',
        deviceModel: 'GE16排 CT',
        servicePeriodStart: '2024-09-03',
        servicePeriodEnd: '2027-09-02',
        maintenanceCycle: 'half-yearly',
      },
    });

    expect(result.ok).toBe(true);
    expect(appServerMgr.callCli).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        '-m', 'med_crm.cli', 'contract_intake',
        '--contract-id', 'jsrm-540ct-full-service',
        '--customer', '江山市人民医院',
        '--device-model', 'GE16排 CT',
        '--service-period-start', '2024-09-03',
        '--service-period-end', '2027-09-02',
        '--maintenance-cycle', 'half-yearly',
      ],
    }));
  });

  it('rejects skills not bound to the employee', async () => {
    const runner = new SkillRunner({ toolRegistry, appServerMgr, corpDir });
    const result = await runner.run({
      employee: makeEmployee({ skills: [] }),
      skill: 'med_crm',
      command: 'global_search',
      args: { keyword: '浙一' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('未绑定');
    expect(appServerMgr.callCli).not.toHaveBeenCalled();
  });

  it('rejects commands outside the employee tool list when tools are explicit', async () => {
    const runner = new SkillRunner({ toolRegistry, appServerMgr, corpDir });
    const result = await runner.run({
      employee: makeEmployee({ tools: ['med_crm:global_search'] }),
      skill: 'med_crm',
      command: 'add_sales_activity',
      args: { hospital: '浙一', summary: '拜访' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('未声明工具');
    expect(appServerMgr.callCli).not.toHaveBeenCalled();
  });

  it('scopes employee memory tools to the employee workspace', async () => {
    const employee = makeEmployee();
    const workspace = join(corpDir, 'acme', 'agents', employee.id);
    const memoryManager = new MemoryManager(join(corpDir, 'data'), {
      subjectDirResolver: (subject) => subject === employee.id ? workspace : undefined,
    });
    const runner = new SkillRunner({ toolRegistry, appServerMgr, corpDir, memoryManager });
    const server = runner.buildEmployeeMcpServer(employee) as unknown as EmployeeMcpServerForTest;

    expect(Object.keys(server.instance._registeredTools)).toEqual([
      'run_skill',
      'memory_append',
      'memory_search',
      'handoff',
    ]);

    const appendResult = await server.instance._registeredTools.memory_append.handler(
      { content: '客户偏好：先给简短结论', date: '2026-05-25' },
      undefined,
    );
    expect(getResultText(appendResult)).toContain('Memory appended');
    expect(readFileSync(join(workspace, 'memory', '2026-05-25.md'), 'utf-8')).toContain('客户偏好');

    const searchResult = await server.instance._registeredTools.memory_search.handler(
      { query: '简短结论' },
      undefined,
    );
    expect(getResultText(searchResult)).toContain('2026-05-25.md');
  });
});
