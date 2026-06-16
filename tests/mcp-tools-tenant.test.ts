import { describe, it, expect } from 'vitest';
import { buildTenantMcpServer, buildSkillSummaryTools } from '../src/mcp-tools.js';
import type { SkillSummary } from '../src/types.js';

describe('buildSkillSummaryTools', () => {
  it('creates a skill: tool for each skill summary', () => {
    const summaries: SkillSummary[] = [
      { name: 'med_crm', displayName: '医院CRM', description: '医疗器械销售 CRM', toolCount: 6, hasServer: true },
      { name: 'device_kb', displayName: '设备知识库', description: '维修知识检索', toolCount: 3, hasServer: false },
    ];

    const tools = buildSkillSummaryTools(summaries, () => Promise.resolve([]));
    expect(tools.length).toBe(3);
    expect(tools[0].name).toBe('skill:med_crm');
    expect(tools[1].name).toBe('skill:device_kb');
    expect(tools[2].name).toBe('_load_skill_tools');
  });

  it('_load_skill_tools returns tool list when skill exists', async () => {
    const summaries: SkillSummary[] = [
      { name: 'med_crm', displayName: '医院CRM', description: '医疗器械销售 CRM', toolCount: 2, hasServer: false },
    ];

    const tools = buildSkillSummaryTools(summaries, async (skillName: string) => {
      expect(skillName).toBe('med_crm');
      return [
        {
          name: 'search_hospitals',
          namespacedName: 'med_crm:search_hospitals',
          description: '搜索医院',
          riskLevel: 'read' as const,
          skillName: 'med_crm',
          skillDir: '/corp/acme/.claude/skills/med_crm',
          appName: 'med_crm',
          tenantName: 'acme',
          hasServer: false,
          parameters: { type: 'object' as const, properties: {} },
        },
      ];
    });

    expect(tools.some((t) => t.name === '_load_skill_tools')).toBe(true);
  });
});

describe('buildTenantMcpServer', () => {
  it('creates an MCP server with correct name', () => {
    const server = buildTenantMcpServer('acme', {
      summaries: [
        { name: 'med_crm', displayName: '医院CRM', description: '医疗器械销售 CRM', toolCount: 2, hasServer: false },
      ],
      onLoadSkillTools: async () => [],
    });

    expect(server).toBeDefined();
    expect(server.name).toBe('tenant-tools');
  });

  it('handles empty summaries', () => {
    const server = buildTenantMcpServer('acme', {
      summaries: [],
      onLoadSkillTools: async () => [],
    });

    expect(server).toBeDefined();
    expect(server.name).toBe('tenant-tools');
  });
});
