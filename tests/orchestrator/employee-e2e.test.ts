import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { employeeDefinitionSchema, type EmployeeDefinition } from '../../src/orchestrator/employee-schema.js';
import type { ToolRegistry } from '../../src/tool-registry.js';
import type { AppServerMgr } from '../../src/app-server.js';
import type { RegisteredTool } from '../../src/types.js';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SkillBridge, type CallerContext } from '../../src/orchestrator/skill-bridge.js';
import type { ClaudeAgent } from '../../src/agent.js';
import { EmployeeManager, type EmployeeManagerDeps } from '../../src/orchestrator/employee-colony.js';

const TEST_TENANT = 'acme';
const MED_CRM_SKILL_DIR = '/corp/acme/.claude/skills/med_crm';

// Self-contained sample employee — materialized to a temp file so the test
// never reaches into an external tenant directory on the host filesystem.
const SALES_EMPLOYEE_YAML = `id: sales-zhangsan
displayName: 销售张三
description: 负责医院客户跟进、合同推进和销售活动记录。
model: deepseek-v4-flash
systemPrompt: |
  你是示例医疗的销售数字员工，负责医院客户查询、合同推进和销售活动记录。
maxTurns: 50
tools:
  - med_crm:search_hospitals
  - med_crm:search_devices
  - med_crm:list_maintenance
  - med_crm:search_bids
  - med_crm:add_sales_activity
  - med_crm:global_search
  - med_crm:hospital_info
skills:
  - med_crm
role: sales
allowedTargets:
  - maintenance-lisi
  - finance-wangwu
schedule:
  triggers:
    - type: cron
      value: '0 9 * * 1-5'
      prompt: 每个工作日早上检查今日待跟进的医院客户和合同。
workspace: agents/sales-zhangsan
source: prepopulated
createdAt: 1716374400000
`;

let tmpRoot: string;
let SAMPLE_YAML: string;

function medCrmTool(tool: Omit<RegisteredTool, 'skillName' | 'skillDir' | 'appName' | 'tenantName' | 'hasServer'>): RegisteredTool {
  return {
    ...tool,
    skillName: 'med_crm',
    skillDir: MED_CRM_SKILL_DIR,
    appName: 'med_crm',
    tenantName: TEST_TENANT,
    hasServer: true,
  };
}

// Expected tools from med_crm tools.json (subset used in sample config)
const MED_CRM_TOOLS: RegisteredTool[] = [
  medCrmTool({
    name: 'search_hospitals',
    description: '搜索医院，支持按省份/城市/渠道/关键词过滤',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { keyword: {}, province: {}, city: {}, channel: {} } },
    namespacedName: 'med_crm:search_hospitals',
  }),
  medCrmTool({
    name: 'search_devices',
    description: '搜索装机设备，支持按品牌/类型/医院过滤',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { keyword: {}, brand: {}, hospital_id: {} } },
    namespacedName: 'med_crm:search_devices',
  }),
  medCrmTool({
    name: 'list_maintenance',
    description: '列出维保合同，支持按到期日期过滤',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { expiring_before: {}, hospital_id: {} } },
    namespacedName: 'med_crm:list_maintenance',
  }),
  medCrmTool({
    name: 'search_bids',
    description: '搜索中标信息',
    riskLevel: 'read',
    parameters: { type: 'object', properties: { keyword: {}, hospital_id: {} } },
    namespacedName: 'med_crm:search_bids',
  }),
  medCrmTool({
    name: 'add_sales_activity',
    description: '添加销售活动/拜访',
    riskLevel: 'internal_write',
    parameters: { type: 'object', properties: {} },
    namespacedName: 'med_crm:add_sales_activity',
  }),
  medCrmTool({
    name: 'add_contact',
    description: '添加联系人',
    riskLevel: 'internal_write',
    parameters: { type: 'object', properties: {} },
    namespacedName: 'med_crm:add_contact',
  }),
  medCrmTool({
    name: 'global_search',
    description: '全局搜索',
    riskLevel: 'read',
    parameters: { type: 'object', properties: {} },
    namespacedName: 'med_crm:global_search',
  }),
  medCrmTool({
    name: 'hospital_info',
    description: '医院详情',
    riskLevel: 'read',
    parameters: { type: 'object', properties: {} },
    namespacedName: 'med_crm:hospital_info',
  }),
];

describe('APP full pipeline E2E', () => {
  let skillBridge: SkillBridge;
  let appDef: EmployeeDefinition;

  beforeAll(() => {
    // 0. Materialize the sample employee YAML in an isolated temp dir
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'hc-employee-e2e-'));
    SAMPLE_YAML = path.join(tmpRoot, 'sales-zhangsan.yaml');
    writeFileSync(SAMPLE_YAML, SALES_EMPLOYEE_YAML, 'utf-8');

    // 1. Load YAML and validate schema
    const { parse } = require('yaml');
    const { readFileSync } = require('fs');
    const raw = readFileSync(SAMPLE_YAML, 'utf-8');
    const parsed = parse(raw);
    appDef = employeeDefinitionSchema.parse(parsed);

    // 2. Set up SkillBridge with mock ToolRegistry
    const toolRegistry = {
      getToolsForTenant: () => MED_CRM_TOOLS,
    } as unknown as ToolRegistry;

    const appServerMgr = {
      call: async () => ({ results: [] }),
      callCli: async () => ({ results: [] }),
      getServerStatus: () => ({ running: true }),
    } as unknown as AppServerMgr;

    skillBridge = new SkillBridge({
      toolRegistry,
      appServerMgr,
      corpDir: '../corp',
    });
  });

  afterAll(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('step 1: sample YAML parses and validates against schema', () => {
    expect(appDef.id).toBe('sales-zhangsan');
    expect(appDef.displayName).toBe('销售张三');
    expect(appDef.model).toBe('deepseek-v4-flash');
    expect(appDef.role).toBe('sales');
    expect(appDef.tools).toHaveLength(7);
    expect(appDef.allowedTargets).toEqual(['maintenance-lisi', 'finance-wangwu']);
    expect(appDef.schedule?.triggers).toHaveLength(1);
    expect(appDef.schedule?.triggers[0]?.type).toBe('cron');
    expect(appDef.schedule?.triggers[0]?.value).toBe('0 9 * * 1-5');
  });

  it('step 2: SkillBridge resolves tools against med_crm tools', () => {
    const resolved = skillBridge.resolveTools(appDef, TEST_TENANT);
    expect(resolved).toHaveLength(8);
    const names = resolved.map((r) => r.registered.namespacedName).sort();
    expect(names).toEqual([
      'med_crm:add_contact',
      'med_crm:add_sales_activity',
      'med_crm:global_search',
      'med_crm:hospital_info',
      'med_crm:list_maintenance',
      'med_crm:search_bids',
      'med_crm:search_devices',
      'med_crm:search_hospitals',
    ]);
  });

  it('step 3: SkillBridge builds MCP tool definitions', () => {
    const callerContext: CallerContext = { agentId: 'sales-zhangsan', role: 'sales' };
    const mcpTools = skillBridge.buildMcpTools(appDef, TEST_TENANT, callerContext);
    expect(mcpTools).toHaveLength(8);

    // SDK tool names must not contain ':'; keep the internal id in the description.
    for (const mcpTool of mcpTools) {
      expect(mcpTool.name).toContain('med_crm.');
      expect(mcpTool.description).toContain('med_crm:');
      expect(mcpTool.description).toBeTruthy();
    }
  });

  it('step 4: SkillBridge builds MCP server', () => {
    const callerContext: CallerContext = { agentId: 'sales-zhangsan', role: 'sales' };
    const server = skillBridge.buildMcpServer(appDef, TEST_TENANT, callerContext);
    expect(server).toBeDefined();
    expect(server.name).toBe('skill-tools:sales-zhangsan');
  });

  it('step 5: Colony registers agent from EmployeeDefinition', () => {
    const colony = new EmployeeManager({
      globalModel: 'claude-sonnet-4-6',
      createAgent: (opts) => ({
        respond: async () => 'ok',
        ...opts,
      }) as unknown as ClaudeAgent,
      skillBridge,
      corpDir: '../corp',
      dataDir: '/data',
    });

    const loadedApp = {
      ...appDef,
      tenantName: TEST_TENANT,
      filePath: SAMPLE_YAML,
      loadedAtMs: Date.now(),
    };

    const { protocol } = colony.register(loadedApp);
    expect(protocol.name).toBe('sales-zhangsan');
    expect(colony.getAppIds()).toEqual(['sales-zhangsan']);
    expect(colony.has('sales-zhangsan', TEST_TENANT)).toBe(true);

    // Verify MCP server is accessible
    const appMcp = colony.getAppMcpServer('sales-zhangsan', { agentId: 'sales-zhangsan', role: 'sales' }, TEST_TENANT);
    expect(appMcp).toBeDefined();
    expect(appMcp!.name).toBe('skill-tools:sales-zhangsan');
  });
});
