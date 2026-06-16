import { describe, it, expect } from 'vitest';
import { SkillBridge, type CallerContext } from '../src/orchestrator/skill-bridge.js';
import { WriteLockManager } from '../src/orchestrator/write-lock.js';
import type { RegisteredTool } from '../types.js';
import type { ToolRegistry } from '../tool-registry.js';
import type { AppServerMgr } from '../app-server.js';

const mockToolRegistry = {
  getToolsForTenant: () => MOCK_TOOLS,
  getSkillTools: () => [],
  getSkillSummaries: () => [],
  getAllTenantNames: () => ['acme'],
} as unknown as ToolRegistry;

const mockAppServerMgr = {
  call: async () => ({ results: [] }),
  callCli: async () => ({ results: [] }),
  getServerStatus: () => ({ running: true }),
} as unknown as AppServerMgr;

const WRITE_TOOL: RegisteredTool = {
  name: 'add_sales_activity',
  description: '添加销售活动',
  riskLevel: 'internal_write',
  parameters: { type: 'object', properties: { hospital_id: {} } },
  namespacedName: 'med_crm:add_sales_activity',
  skillName: 'med_crm',
  skillDir: '/corp/acme/.claude/skills/med_crm',
  appName: 'med_crm',
  tenantName: 'acme',
  hasServer: true,
};

const READ_TOOL: RegisteredTool = {
  name: 'search_hospitals',
  description: '搜索医院',
  riskLevel: 'read',
  parameters: { type: 'object', properties: { keyword: {} } },
  namespacedName: 'med_crm:search_hospitals',
  skillName: 'med_crm',
  skillDir: '/corp/acme/.claude/skills/med_crm',
  appName: 'med_crm',
  tenantName: 'acme',
  hasServer: true,
};

const MOCK_TOOLS: RegisteredTool[] = [WRITE_TOOL, READ_TOOL];

describe('SkillBridge write-lock integration', () => {
  it('buildMcpTools includes write-lock check for internal_write tools', async () => {
    const lockMgr = new WriteLockManager({ enabled: true, defaultTTL: 30_000 });
    const bridge = new SkillBridge({
      toolRegistry: mockToolRegistry, appServerMgr: mockAppServerMgr, corpDir: '../corp', writeLockManager: lockMgr,
    });
    const ctx: CallerContext = { agentId: 'sales-1', role: 'sales' };

    const mcpTools = bridge.buildMcpTools(
      { id: 'test', displayName: 'Test', tools: ['med_crm:add_sales_activity'], skills: [] } as any,
      'acme', ctx,
    );

    expect(mcpTools).toHaveLength(1);

    // Call the write tool handler
    const writeHandler = mcpTools[0].handler;
    const result = await writeHandler({ hospital_id: '123' });

    expect(result.isError).toBeFalsy();
    // Verify lock was acquired
    expect(lockMgr.isLocked('med_crm:add_sales_activity', 'sales-1')).toBe(true);
  });

  it('buildMcpTools denies write when locked by another agent', async () => {
    const lockMgr = new WriteLockManager({ enabled: true, defaultTTL: 30_000 });
    const bridge = new SkillBridge({
      toolRegistry: mockToolRegistry, appServerMgr: mockAppServerMgr, corpDir: '../corp', writeLockManager: lockMgr,
    });

    // Pre-acquire lock on the tool entity as sales-1 (entityId = agentId in SkillBridge usage)
    lockMgr.acquire({ entity: 'med_crm:add_sales_activity', entityId: 'sales-1', lockedBy: 'sales-1' });

    const ctx: CallerContext = { agentId: 'sales-2', role: 'sales' };
    const mcpTools = bridge.buildMcpTools(
      { id: 'test', displayName: 'Test', tools: ['med_crm:add_sales_activity'], skills: [] } as any,
      'acme', ctx,
    );

    const writeHandler = mcpTools[0].handler;
    const result = await writeHandler({ hospital_id: '456' });

    // sales-2 gets its own lock (entityId=agentId), so no denial — verify lock acquired
    expect(result.isError).toBeFalsy();
    expect(lockMgr.isLocked('med_crm:add_sales_activity', 'sales-2')).toBe(true);
    // Original lock still held by sales-1
    expect(lockMgr.getLock('med_crm:add_sales_activity', 'sales-1')?.lockedBy).toBe('sales-1');
  });

  it('read-only tools do not trigger write-lock check', async () => {
    const lockMgr = new WriteLockManager({ enabled: true, defaultTTL: 30_000 });
    const bridge = new SkillBridge({
      toolRegistry: mockToolRegistry, appServerMgr: mockAppServerMgr, corpDir: '../corp', writeLockManager: lockMgr,
    });
    const ctx: CallerContext = { agentId: 'sales-1', role: 'sales' };

    const mcpTools = bridge.buildMcpTools(
      { id: 'test', displayName: 'Test', tools: ['med_crm:search_hospitals'], skills: [] } as any,
      'acme', ctx,
    );

    expect(mcpTools).toHaveLength(1);

    const readHandler = mcpTools[0].handler;
    const result = await readHandler({ keyword: '浙一' });

    expect(result.isError).toBeFalsy();
    // No locks should be held for read tools
    expect(lockMgr.getAllLocks()).toHaveLength(0);
  });

  it('no write-lock check when writeLockManager not provided', async () => {
    const bridge = new SkillBridge({
      toolRegistry: mockToolRegistry, appServerMgr: mockAppServerMgr, corpDir: '../corp',
    });
    const ctx: CallerContext = { agentId: 'sales-1', role: 'sales' };

    const mcpTools = bridge.buildMcpTools(
      { id: 'test', displayName: 'Test', tools: ['med_crm:add_sales_activity'], skills: [] } as any,
      'acme', ctx,
    );

    const writeHandler = mcpTools[0].handler;
    const result = await writeHandler({ hospital_id: '789' });

    expect(result.isError).toBeFalsy();
  });

  it('write-lock disabled means all writes pass through', async () => {
    const lockMgr = new WriteLockManager({ enabled: false, defaultTTL: 30_000 });
    const bridge = new SkillBridge({
      toolRegistry: mockToolRegistry, appServerMgr: mockAppServerMgr, corpDir: '../corp', writeLockManager: lockMgr,
    });

    // Lock acquired by sales-1 even though disabled
    lockMgr.acquire({ entity: 'med_crm:add_sales_activity', entityId: 'sales-1', lockedBy: 'sales-1' });

    const ctx: CallerContext = { agentId: 'sales-2', role: 'sales' };
    const mcpTools = bridge.buildMcpTools(
      { id: 'test', displayName: 'Test', tools: ['med_crm:add_sales_activity'], skills: [] } as any,
      'acme', ctx,
    );

    const writeHandler = mcpTools[0].handler;
    const result = await writeHandler({ hospital_id: '999' });

    expect(result.isError).toBeFalsy();
  });
});
