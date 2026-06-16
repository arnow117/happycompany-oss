import { stringify as stringifyYaml } from 'yaml';
import type { AgentDraft } from './schema.js';

export function buildHarnessYamlForDraft(draft: AgentDraft): string {
  const firstTool = draft.employee.tools[0];
  const replyNeedle = draft.employee.displayName || draft.employee.id;
  return stringifyYaml({
    id: `agent-builder-${draft.employee.id}`,
    description: `Generated Agent Builder smoke case for ${draft.employee.id}`,
    input: {
      channel: 'harness',
      botName: draft.employee.id,
      tenant: draft.tenant,
      userId: `employee:${draft.employee.id}`,
      chatId: `harness-agent-builder-${draft.employee.id}`,
      text: draft.employee.description || `请${draft.employee.displayName}处理一个职责范围内的问题`,
    },
    fakeReply: `${replyNeedle} 已收到并处理请求。`,
    simulated: {
      routing: { selectedEmployee: draft.employee.id },
      ...(firstTool ? { toolCalls: [{ name: firstTool, elapsedMs: 10 }] } : {}),
    },
    expect: {
      routedEmployee: draft.employee.id,
      ...(firstTool ? { toolNamesIncludes: [firstTool] } : {}),
      replyContains: [replyNeedle],
      noErrors: true,
    },
  });
}
