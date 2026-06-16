import { describe, expect, it } from 'vitest';
import { renderEmployeeClaudeMd } from '../../src/orchestrator/employee-prompt.js';
import type { EmployeeDefinition } from '../../src/orchestrator/employee-schema.js';

function makeEmployee(overrides: Partial<EmployeeDefinition> = {}): EmployeeDefinition {
  return {
    id: 'maintenance-qa',
    displayName: '售后质检员工',
    description: '检查维修工单质量',
    model: 'claude-sonnet-4-6',
    systemPrompt: '你负责检查维修记录是否完整，赔付问题转交财务。',
    maxTurns: 50,
    tools: ['med_crm:list_maintenance', 'med_crm:add_incident'],
    skills: ['med_crm'],
    workspace: 'agents/maintenance-qa',
    role: 'maintenance',
    allowedTargets: ['finance-wangwu'],
    capabilities: ['维修质检', '工单复核'],
    source: 'generated',
    createdAt: 1716374400000,
    ...overrides,
  };
}

describe('renderEmployeeClaudeMd', () => {
  it('renders employee identity, long-term prompt, tools, skills, and boundaries', () => {
    const markdown = renderEmployeeClaudeMd(makeEmployee());

    expect(markdown).toContain('# 售后质检员工');
    expect(markdown).toContain('- 员工 ID: maintenance-qa');
    expect(markdown).toContain('你负责检查维修记录是否完整');
    expect(markdown).toContain('- med_crm');
    expect(markdown).toContain('- med_crm:list_maintenance');
    expect(markdown).toContain('- finance-wangwu');
    expect(markdown).toContain('- 维修质检');
    expect(markdown).toContain('不要跨员工工作目录读取或写入文件');
  });

  it('renders explicit empty states for optional lists', () => {
    const markdown = renderEmployeeClaudeMd(makeEmployee({
      skills: [],
      tools: [],
      allowedTargets: [],
      capabilities: [],
    }));

    expect(markdown.match(/- 无/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
