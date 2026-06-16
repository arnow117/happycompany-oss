import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ToolRegistry } from '../src/tool-registry.js';
import { buildTenantMcpServer, buildSkillSummaryTools } from '../src/mcp-tools.js';

const CORP_DIR = path.resolve(__dirname, '..', 'corp');

describe('Phase 1 Integration: Tool Manifest Pipeline', () => {
  it('ToolRegistry scans real corp/acme skill package structure', () => {
    const registry = new ToolRegistry(CORP_DIR);
    registry.scan();

    const tenants = registry.getAllTenantNames();
    expect(tenants).toContain('acme');

    const tools = registry.getToolsForTenant('acme');
    expect(tools.length).toBeGreaterThanOrEqual(9);

    const namespaced = tools.map((t) => t.namespacedName);
    expect(namespaced).toContain('med_crm:search_hospitals');
    expect(namespaced).toContain('med_crm:global_search');
    expect(namespaced).toContain('med_crm:hospital_info');
  });

  it('skill summaries reflect correct tool count and server status', () => {
    const registry = new ToolRegistry(CORP_DIR);
    registry.scan();

    const summaries = registry.getSkillSummaries('acme');
    expect(summaries.length).toBeGreaterThanOrEqual(1);

    const medCrm = summaries.find((s) => s.name === 'med_crm');
    expect(medCrm).toBeDefined();
    expect(medCrm!.displayName).toBe('医院CRM');
    expect(medCrm!.toolCount).toBe(12);
    expect(medCrm!.hasServer).toBe(true);
  });

  it('buildTenantMcpServer creates MCP server with skill summary tools', () => {
    const registry = new ToolRegistry(CORP_DIR);
    registry.scan();

    const summaries = registry.getSkillSummaries('acme');
    const server = buildTenantMcpServer('acme', {
      tenantName: 'acme',
      summaries,
      onLoadSkillTools: async (skillName: string) =>
        registry.getSkillTools('acme', skillName),
    });

    expect(server).toBeDefined();
    expect(server.name).toBe('tenant-tools');
  });

  it('buildSkillSummaryTools creates skill: and _load_skill_tools tools', async () => {
    const registry = new ToolRegistry(CORP_DIR);
    registry.scan();

    const summaries = registry.getSkillSummaries('acme');
    const tools = buildSkillSummaryTools(summaries, async (skillName: string) =>
      registry.getSkillTools('acme', skillName),
    );

    expect(tools.some((t) => t.name === 'skill:med_crm')).toBe(true);
    expect(tools.some((t) => t.name === '_load_skill_tools')).toBe(true);

    // Invoke _load_skill_tools handler to verify it returns tool list
    const loadTool = tools.find((t) => t.name === '_load_skill_tools')!;
    const result = await loadTool.handler({ skill_name: 'med_crm' });
    const text = result.content[0]?.text as string;
    expect(text).toContain('med_crm:search_hospitals');
    expect(text).toContain('med_crm:global_search');
  });

  it('tools have correct risk levels from tools.json', () => {
    const registry = new ToolRegistry(CORP_DIR);
    registry.scan();

    const searchTool = registry.lookup('acme', 'med_crm:search_hospitals');
    expect(searchTool?.riskLevel).toBe('read');

    const writeTool = registry.lookup('acme', 'med_crm:add_sales_activity');
    expect(writeTool?.riskLevel).toBe('internal_write');
  });

  it('getSkillTools returns full RegisteredTool with parameter schemas for a skill', () => {
    const registry = new ToolRegistry(CORP_DIR);
    registry.scan();

    const tools = registry.getSkillTools('acme', 'med_crm');
    const searchHospitals = tools.find((t) => t.name === 'search_hospitals');

    expect(searchHospitals).toBeDefined();
    expect(searchHospitals!.skillName).toBe('med_crm');
    expect(searchHospitals!.skillDir).toContain(path.join('corp', 'acme', '.claude', 'skills', 'med_crm'));
    expect(searchHospitals!.parameters).toBeDefined();
    expect(searchHospitals!.parameters.type).toBe('object');
    expect(searchHospitals!.parameters.properties).toHaveProperty('keyword');
  });
});
