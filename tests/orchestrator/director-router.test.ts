import { describe, expect, it } from 'vitest';
import { keywordMatch } from '../../src/orchestrator/director-router.js';
import type { AgentMeta } from '../../src/orchestrator/director-router.js';

describe('director-router keywordMatch', () => {
  it('prefers specific maintenance responsibility over generic employee workflow terms', () => {
    const agents: AgentMeta[] = [
      {
        id: 'hr-onboarding',
        role: 'hr',
        description: '负责员工入职和流程编排',
        capabilities: ['入职', '员工', 'HR', '流程编排'],
      },
      {
        id: 'maintenance-lisi',
        role: 'maintenance',
        description: '负责合同执行、现场维修与回执签署',
        capabilities: ['维修', '工单', '故障诊断', '回执签署'],
      },
    ];

    const result = keywordMatch('如果我是示例医疗员工，设备维修问题该找谁？请按企业工作流自主编排处理。', agents, 0.3);

    expect(result?.agentId).toBe('maintenance-lisi');
    expect(result?.score).toBeGreaterThan(0);
  });
});
