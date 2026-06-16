import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RegisteredTool } from '../../src/types.js';
import type { ToolRegistry } from '../../src/tool-registry.js';
import type { AppServerMgr } from '../../src/app-server.js';
import { SkillBridge, type CallerContext, matchToolPattern, toSdkToolName } from '../../src/orchestrator/skill-bridge.js';

function makeTool(overrides: Partial<RegisteredTool> & { namespacedName: string }): RegisteredTool {
  return {
    name: overrides.namespacedName.split(':')[1] ?? overrides.namespacedName,
    description: `Tool ${overrides.namespacedName}`,
    riskLevel: 'read',
    parameters: { type: 'object', properties: { q: {} }, required: ['q'] },
    namespacedName: overrides.namespacedName,
    skillName: overrides.skillName ?? overrides.namespacedName.split(':')[0],
    skillDir: overrides.skillDir ?? `/corp/acme/.claude/skills/${overrides.namespacedName.split(':')[0]}`,
    appName: overrides.appName ?? overrides.namespacedName.split(':')[0],
    tenantName: overrides.tenantName ?? 'acme',
    hasServer: overrides.hasServer ?? false,
    ...overrides,
  };
}

const callerContext: CallerContext = {
  agentId: 'sales-zhangsan',
  role: 'sales',
  owner: 'zhangsan',
};

describe('matchToolPattern', () => {
  it('matches exact pattern', () => {
    expect(matchToolPattern('med_crm:search_hospitals', 'med_crm:search_hospitals')).toBe(true);
  });

  it('does not match different exact pattern', () => {
    expect(matchToolPattern('med_crm:search_hospitals', 'med_crm:search_devices')).toBe(false);
  });

  it('matches full wildcard pattern (app:*)', () => {
    expect(matchToolPattern('med_crm:*', 'med_crm:search_hospitals')).toBe(true);
    expect(matchToolPattern('med_crm:*', 'med_crm:contract_read')).toBe(true);
    expect(matchToolPattern('med_crm:*', 'other_app:something')).toBe(false);
  });

  it('matches partial wildcard pattern (app:prefix_*)', () => {
    expect(matchToolPattern('med_crm:search_*', 'med_crm:search_hospitals')).toBe(true);
    expect(matchToolPattern('med_crm:search_*', 'med_crm:search_devices')).toBe(true);
    expect(matchToolPattern('med_crm:search_*', 'med_crm:contract_read')).toBe(false);
  });

  it('matches middle wildcard', () => {
    expect(matchToolPattern('med_crm:search_*_by_name', 'med_crm:search_hospitals_by_name')).toBe(true);
    expect(matchToolPattern('med_crm:search_*_by_name', 'med_crm:search_hospitals')).toBe(false);
  });

  it('matches no-wildcard exact only', () => {
    expect(matchToolPattern('med_crm:search', 'med_crm:search')).toBe(true);
    expect(matchToolPattern('med_crm:search', 'med_crm:search_hospitals')).toBe(false);
  });
});

describe('toSdkToolName', () => {
  it('replaces namespace separators with SDK-safe characters', () => {
    expect(toSdkToolName('med_crm:search_hospitals')).toBe('med_crm.search_hospitals');
  });
});

describe('SkillBridge', () => {
  let bridge: SkillBridge;
  let mockToolRegistry: ToolRegistry;
  let mockAppServerMgr: AppServerMgr;
  const tenantTools: RegisteredTool[] = [
    makeTool({ namespacedName: 'med_crm:search_hospitals', appName: 'med_crm', tenantName: 'acme', hasServer: true }),
    makeTool({ namespacedName: 'med_crm:search_devices', appName: 'med_crm', tenantName: 'acme', hasServer: true }),
    makeTool({ namespacedName: 'med_crm:list_maintenance', appName: 'med_crm', tenantName: 'acme', hasServer: false }),
    makeTool({ namespacedName: 'med_crm:contract_read', appName: 'med_crm', tenantName: 'acme', hasServer: true }),
    makeTool({ namespacedName: 'stats:revenue', appName: 'stats', tenantName: 'acme', hasServer: false }),
  ];

  beforeEach(() => {
    mockToolRegistry = {
      getToolsForTenant: vi.fn().mockReturnValue(tenantTools),
    } as unknown as ToolRegistry;

    mockAppServerMgr = {
      call: vi.fn().mockResolvedValue({ result: 'ok' }),
      callCli: vi.fn().mockResolvedValue({ result: 'ok' }),
      getServerStatus: vi.fn().mockReturnValue({ running: true }),
    } as unknown as AppServerMgr;

    bridge = new SkillBridge({
      toolRegistry: mockToolRegistry,
      appServerMgr: mockAppServerMgr,
      corpDir: '/corp',
    });
  });

  describe('resolveTools', () => {
    it('resolves exact tool pattern match', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:search_hospitals'], skills: [] } as any;
      const resolved = bridge.resolveTools(app, 'acme');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].registered.namespacedName).toBe('med_crm:search_hospitals');
      expect(resolved[0].matchedPattern).toBe('med_crm:search_hospitals');
    });

    it('resolves wildcard suffix pattern (med_crm:search_*)', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:search_*'], skills: [] } as any;
      const resolved = bridge.resolveTools(app, 'acme');
      const names = resolved.map((r) => r.registered.namespacedName).sort();
      expect(names).toEqual(['med_crm:search_devices', 'med_crm:search_hospitals']);
    });

    it('resolves full wildcard pattern (med_crm:*)', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:*'], skills: [] } as any;
      const resolved = bridge.resolveTools(app, 'acme');
      expect(resolved).toHaveLength(4);
    });

    it('expands skills shorthand to all tools in skill', () => {
      const app = { id: 'test', displayName: 'Test', tools: [], skills: ['med_crm'] } as any;
      const resolved = bridge.resolveTools(app, 'acme');
      expect(resolved).toHaveLength(4);
      expect(resolved[0].matchedPattern).toBe('skill:med_crm');
    });

    it('returns empty array when no patterns match', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['nonexistent:tool'], skills: [] } as any;
      const resolved = bridge.resolveTools(app, 'acme');
      expect(resolved).toHaveLength(0);
    });

    it('deduplicates tools matched by both tools[] and skills[]', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:search_hospitals'], skills: ['med_crm'] } as any;
      const resolved = bridge.resolveTools(app, 'acme');
      const names = resolved.map((r) => r.registered.namespacedName);
      // search_hospitals should appear once
      const count = names.filter((n) => n === 'med_crm:search_hospitals').length;
      expect(count).toBe(1);
      expect(resolved).toHaveLength(4);
    });

    it('resolves from correct tenant', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:*'], skills: [] } as any;
      bridge.resolveTools(app, 'acme');
      expect(mockToolRegistry.getToolsForTenant).toHaveBeenCalledWith('acme');
    });

    it('resolves multiple explicit patterns', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:search_hospitals', 'stats:revenue'], skills: [] } as any;
      const resolved = bridge.resolveTools(app, 'acme');
      const names = resolved.map((r) => r.registered.namespacedName).sort();
      expect(names).toEqual(['med_crm:search_hospitals', 'stats:revenue']);
    });
  });

  describe('buildMcpTools', () => {
    it('produces one SdkMcpToolDefinition per resolved tool', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:search_hospitals'], skills: [] } as any;
      const mcpTools = bridge.buildMcpTools(app, 'acme', callerContext);
      expect(mcpTools).toHaveLength(1);
      expect(mcpTools[0].name).toBe('med_crm.search_hospitals');
      expect(mcpTools[0].description).toBeTruthy();
      expect(mcpTools[0].description).toContain('med_crm:search_hospitals');
    });

    it('tool handler invokes AppServerMgr.call() for server-based apps', async () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:search_hospitals'], skills: [] } as any;
      const mcpTools = bridge.buildMcpTools(app, 'acme', callerContext);
      const result = await mcpTools[0].handler({ q: 'test' }, {});
      expect(mockAppServerMgr.call).toHaveBeenCalledWith(
        'acme:med_crm',
        'search_hospitals',
        expect.objectContaining({ q: 'test', callerContext }),
      );
      expect(result.content[0]).toHaveProperty('type', 'text');
    });

    it('tool handler invokes AppServerMgr.callCli() for CLI-based skills', async () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:list_maintenance'], skills: [] } as any;
      const mcpTools = bridge.buildMcpTools(app, 'acme', callerContext);
      await mcpTools[0].handler({}, {});
      expect(mockAppServerMgr.callCli).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/corp/acme/.claude/skills/med_crm',
          command: 'list_maintenance',
        }),
      );
    });

    it('injects callerContext into tool params', async () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:contract_read'], skills: [] } as any;
      const mcpTools = bridge.buildMcpTools(app, 'acme', callerContext);
      await mcpTools[0].handler({ contractId: '001' }, {});
      expect(mockAppServerMgr.call).toHaveBeenCalledWith(
        'acme:med_crm',
        'contract_read',
        expect.objectContaining({
          contractId: '001',
          callerContext: { agentId: 'sales-zhangsan', role: 'sales', owner: 'zhangsan' },
        }),
      );
    });

    it('returns error result when call fails', async () => {
      vi.mocked(mockAppServerMgr.call).mockRejectedValueOnce(new Error('Server not running'));
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:search_hospitals'], skills: [] } as any;
      const mcpTools = bridge.buildMcpTools(app, 'acme', callerContext);
      const result = await mcpTools[0].handler({ q: 'test' }, {});
      expect(result.content[0].text).toContain('Server not running');
      expect(result.isError).toBe(true);
    });

    it('returns error result when callCli fails', async () => {
      vi.mocked(mockAppServerMgr.callCli).mockRejectedValueOnce(new Error('CLI timeout'));
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:list_maintenance'], skills: [] } as any;
      const mcpTools = bridge.buildMcpTools(app, 'acme', callerContext);
      const result = await mcpTools[0].handler({}, {});
      expect(result.content[0].text).toContain('CLI timeout');
      expect(result.isError).toBe(true);
    });
  });

  describe('buildMcpServer', () => {
    it('creates an MCP server with resolved tools', () => {
      const app = { id: 'test', displayName: 'Test', tools: ['med_crm:search_hospitals'], skills: [] } as any;
      const server = bridge.buildMcpServer(app, 'acme', callerContext);
      expect(server).toBeDefined();
      expect(server.name).toBe('skill-tools:test');
    });
  });
});
