import { type Page, type Route } from '@playwright/test';
import { setupToken } from './helpers';

export const probeTenant = {
  id: 'acme-happycompany',
  displayName: '示例医疗 HappyCompany',
};

export const probeAltTenant = {
  id: 'acme-demo',
  displayName: 'ACME Demo',
};

export const probeBots = [
  {
    name: 'web-bot',
    displayName: 'Web 入口',
    status: 'running',
    channel: 'web',
    tenant: probeTenant.id,
    routingMode: 'employee-director',
    workdir: `/corp/${probeTenant.id}/agents/web-bot`,
    model: 'claude-sonnet-4-6',
  },
  {
    name: 'support-bot',
    displayName: '售后入口',
    status: 'running',
    channel: 'web',
    tenant: probeTenant.id,
    routingMode: 'direct',
    workdir: `/corp/${probeTenant.id}/agents/support-bot`,
    model: 'claude-sonnet-4-6',
  },
] as const;

export const probeEmployee = {
  id: 'sales-zhangsan',
  displayName: '销售张三',
  description: '负责客户跟进。',
  role: 'sales',
  skills: ['med_crm'],
  tools: ['med_crm:global_search'],
  model: 'claude-sonnet-4-6',
  workspace: 'agents/sales-zhangsan',
  source: 'generated',
};

export const probeHandoffEmployee = {
  id: 'maintenance-lisi',
  displayName: '维修李四',
  description: '负责设备维保和维修记录核验。',
  role: 'maintenance',
  skills: ['maintenance_records'],
  tools: ['maintenance_records:lookup'],
  model: 'claude-sonnet-4-6',
  workspace: 'agents/maintenance-lisi',
  source: 'generated',
};

export const probePerson = {
  userId: 'u-sales-001',
  name: '销售主管',
  departments: [{ id: 'sales', name: '销售部' }],
  status: 'active',
  role: 'sales',
  entryEmployee: 'sales-zhangsan',
  assistantId: 'sales-zhangsan',
};

export const probeRuntimeSession = {
  id: 'session-sales-activation',
  tenant: probeTenant.id,
  entryId: 'web-bot',
  channel: 'web',
  actorId: probePerson.userId,
  chatId: 'chat-sales-activation',
  employeeId: probeEmployee.id,
  instanceId: 'i-sales-zhangsan',
  workdir: `/corp/${probeTenant.id}/agents/${probeEmployee.id}`,
  sdkSessionScope: `${probeTenant.id}:web-bot:${probePerson.userId}:${probeEmployee.id}:chat-sales-activation`,
  mode: 'single_employee',
  messageCount: 2,
  lastMessageAt: Date.now(),
  preview: '客户跟进需要准备报价方案',
};

export const probeHandoffSession = {
  id: 'session-handoff-maintenance',
  tenant: probeTenant.id,
  entryId: 'web-bot',
  channel: 'web',
  actorId: probePerson.userId,
  chatId: 'chat-handoff-maintenance',
  employeeId: probeHandoffEmployee.id,
  instanceId: 'i-maintenance-lisi',
  workdir: `/corp/${probeTenant.id}/agents/${probeHandoffEmployee.id}`,
  sdkSessionScope: `${probeTenant.id}:web-bot:${probePerson.userId}:${probeHandoffEmployee.id}:chat-handoff-maintenance`,
  mode: 'workflow_handoff',
  messageCount: 4,
  lastMessageAt: Date.now() + 1000,
  preview: '客户问 CT 设备维保状态，需要销售转维修核验',
};

export const probeRuntimeCases = [
  {
    id: 'case-sales-handoff-maintenance',
    tenant: probeTenant.id,
    sessionId: probeHandoffSession.id,
    entryId: 'web-bot',
    actorId: probePerson.userId,
    chatId: probeHandoffSession.chatId,
    title: '销售到维修的维保核验',
    state: 'completed',
    currentEmployeeId: probeHandoffEmployee.id,
    participants: [probeEmployee.id, probeHandoffEmployee.id],
    handoffCount: 1,
    toolCallCount: 1,
    lastMessageAt: probeHandoffSession.lastMessageAt,
    messageCount: 4,
    preview: probeHandoffSession.preview,
  },
  {
    id: 'case-sales-quote',
    tenant: probeTenant.id,
    sessionId: probeRuntimeSession.id,
    entryId: 'web-bot',
    actorId: probePerson.userId,
    chatId: probeRuntimeSession.chatId,
    title: '销售报价准备',
    state: 'active',
    currentEmployeeId: probeEmployee.id,
    participants: [probeEmployee.id],
    handoffCount: 0,
    toolCallCount: 1,
    lastMessageAt: probeRuntimeSession.lastMessageAt,
    messageCount: probeRuntimeSession.messageCount,
    preview: probeRuntimeSession.preview,
  },
] as const;

export const probeHandoffTimeline = [
  {
    id: 'tl-user-1',
    type: 'user_message',
    at: Date.now() - 5000,
    employeeId: probeEmployee.id,
    text: '客户问 CT 设备维保状态，需要销售转维修核验',
  },
  {
    id: 'tl-route-1',
    type: 'routing_decision',
    at: Date.now() - 4200,
    employeeId: probeEmployee.id,
    payload: {
      selectedEmployee: probeEmployee.id,
      boundEmployee: probeEmployee.id,
    },
  },
  {
    id: 'tl-handoff-1',
    type: 'handoff',
    at: Date.now() - 3000,
    fromEmployeeId: probeEmployee.id,
    toEmployeeId: probeHandoffEmployee.id,
    reason: '需要确认设备维保记录',
  },
  {
    id: 'tl-tool-1',
    type: 'tool_call',
    at: Date.now() - 1800,
    employeeId: probeHandoffEmployee.id,
    toolName: 'maintenance_records:lookup',
    status: 'completed',
  },
  {
    id: 'tl-agent-1',
    type: 'agent_message',
    at: Date.now() - 500,
    employeeId: probeHandoffEmployee.id,
    text: '维修李四确认：GE16排 CT 维保有效期到 2026-12-31。',
  },
] as const;

export const probeHarnessCase = {
  id: 'contract-service-chain-smoke',
  description: '验证 Web 入口可以把合同维保问题路由到销售员工，并记录工具、记忆和 handoff trace。',
  file: 'contract-service-chain-smoke.yaml',
  input: {
    channel: 'web',
    botName: 'web-bot',
    tenant: probeTenant.id,
    userId: probePerson.userId,
    handoffMode: 'auto',
  },
  expect: {
    routedEmployee: probeEmployee.id,
    selectorShown: false,
    handoffCount: 1,
    toolNamesIncludes: ['maintenance_records:lookup'],
    noErrors: true,
  },
} as const;

export const probeHarnessReport = {
  id: 'report-contract-service-chain',
  createdAt: new Date().toISOString(),
  summary: { passed: 1, failed: 0, total: 1 },
  results: [
    {
      case: {
        ...probeHarnessCase,
        input: {
          ...probeHarnessCase.input,
          chatId: 'harness-chat-contract-service',
          text: '查询江山市人民医院 GE16排 CT 维保合同状态。',
        },
        expect: {
          ...probeHarnessCase.expect,
          replyContains: ['维保有效期到 2026-12-31'],
        },
      },
      status: 'passed',
      failures: [],
      ingress: {
        reply: '销售张三已完成核验：维保有效期到 2026-12-31，建议推进续保报价。',
        trace: {
          input: {
            channel: 'web',
            botName: 'web-bot',
            tenant: probeTenant.id,
            userId: probePerson.userId,
            chatId: 'harness-chat-contract-service',
          },
          routing: {
            mode: 'employee-director',
            selectedEmployee: probeEmployee.id,
            boundEmployee: probeEmployee.id,
            selectorShown: false,
          },
          toolCalls: [{ name: 'maintenance_records:lookup', status: 'completed', elapsedMs: 430 }],
          memory: [{ operation: 'read', subject: 'contract-service-chain', workspace: probeEmployee.workspace, status: 'completed' }],
          handoffs: [{ from: probeEmployee.id, to: probeHandoffEmployee.id, reason: '核验维保记录' }],
          errors: [],
          startedAt: Date.now() - 3000,
          finishedAt: Date.now(),
        },
      },
    },
  ],
  text: '1 passed, 0 failed. contract-service-chain-smoke passed.',
} as const;

export const probeHarnessStepRun = {
  id: 'step-run-contract-service-chain',
  input: {
    workflowRunId: 'contract-service-chain-smoke',
    stepId: 'sales-contract-fields',
    employeeId: probeEmployee.id,
    tenant: probeTenant.id,
    userId: 'web-harness-user',
    chatId: 'harness-step-chat-contract',
    prompt: '查询并输出江山市人民医院 GE16排 CT 维保合同的客户、设备、合同期限、金额和付款条款。',
  },
  status: 'passed',
  createdAt: Date.now(),
  completedAt: Date.now() + 1000,
  reply: '已完成销售签约字段确认。',
  trace: probeHarnessReport.results[0].ingress.trace,
} as const;

export type ProbeApiHandler = (route: Route, url: URL) => Promise<boolean>;

export async function setupProbeConsole(page: Page, handleApi?: ProbeApiHandler): Promise<void> {
  await setupToken(page);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());

    if (handleApi && await handleApi(route, url)) {
      return;
    }

    if (url.pathname === '/api/admin/session') {
      await route.fulfill({ json: { authenticated: true, mode: 'protected' } });
      return;
    }

    if (url.pathname === '/api/setup/status') {
      await route.fulfill({
        json: {
          configured: true,
          steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true },
        },
      });
      return;
    }

    if (url.pathname === '/api/health') {
      await route.fulfill({ json: { status: 'ok', bots: probeBots } });
      return;
    }

    if (url.pathname === '/api/tenants') {
      await route.fulfill({ json: { tenants: [probeTenant, probeAltTenant] } });
      return;
    }

    if (url.pathname === '/api/chats') {
      await route.fulfill({
        json: [
          { botName: 'web-bot', chatId: 'probe-chat-1', messageCount: 4, lastMessageAt: Date.now() },
        ],
      });
      return;
    }

    if (url.pathname === '/api/admin/workdirs') {
      await route.fulfill({
        json: [
          {
            path: `/corp/${probeTenant.id}/agents/web-bot`,
            info: { path: `/corp/${probeTenant.id}/agents/web-bot` },
            bots: [probeBots[0]],
          },
        ],
      });
      return;
    }

    if (url.pathname === '/api/employees') {
      await route.fulfill({
        json: {
          employees: [probeEmployee, probeHandoffEmployee],
        },
      });
      return;
    }

    if (url.pathname === '/api/enterprise-people') {
      await route.fulfill({ json: { people: [probePerson] } });
      return;
    }

    if (url.pathname === '/api/web-chat/config') {
      await route.fulfill({
        json: {
          welcomeTitle: '你好，有什么可以帮你？',
          welcomeSubtitle: '选择下方话题快速开始，或直接输入你的问题。',
          inputPlaceholder: '输入业务请求...',
          historyLimit: 50,
          enableImageUpload: false,
          showSessionPicker: true,
          showQuickPrompts: false,
        },
      });
      return;
    }

    if (url.pathname === '/api/runtime/entries') {
      await route.fulfill({
        json: {
          entries: [
            {
              id: 'web-bot',
              tenant: probeTenant.id,
              channel: 'web',
              displayName: 'Web 入口',
              routingMode: 'employee-director',
              enabled: true,
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === '/api/runtime/actors') {
      await route.fulfill({
        json: {
          actors: [
            {
              tenant: probeTenant.id,
              actorId: probePerson.userId,
              source: 'people',
              displayName: probePerson.name,
              peopleUserId: probePerson.userId,
              bindings: [{ employeeId: probeEmployee.id, role: 'sales', isDefault: true }],
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === '/api/runtime/targets') {
      await route.fulfill({
        json: {
          targets: [
            {
              employeeId: probeEmployee.id,
              displayName: probeEmployee.displayName,
              role: 'sales',
              oneLiner: '负责客户跟进。',
              isDefault: true,
            },
            {
              employeeId: probeHandoffEmployee.id,
              displayName: probeHandoffEmployee.displayName,
              role: probeHandoffEmployee.role,
              oneLiner: probeHandoffEmployee.description,
              isDefault: false,
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === '/api/runtime/cases') {
      const tenant = url.searchParams.get('tenant');
      await route.fulfill({
        json: {
          cases: probeRuntimeCases.filter((item) => !tenant || item.tenant === tenant),
        },
      });
      return;
    }

    if (url.pathname === `/api/runtime/cases/${probeRuntimeCases[0].id}/timeline`) {
      await route.fulfill({
        json: {
          case: probeRuntimeCases[0],
          timeline: probeHandoffTimeline,
        },
      });
      return;
    }

    if (url.pathname === `/api/runtime/cases/${probeRuntimeCases[1].id}/timeline`) {
      await route.fulfill({
        json: {
          case: probeRuntimeCases[1],
          timeline: [
            {
              id: 'tl-sales-user',
              type: 'user_message',
              at: probeRuntimeSession.lastMessageAt - 1000,
              employeeId: probeEmployee.id,
              text: probeRuntimeSession.preview,
            },
            {
              id: 'tl-sales-tool',
              type: 'tool_call',
              at: probeRuntimeSession.lastMessageAt - 500,
              employeeId: probeEmployee.id,
              toolName: 'med_crm:global_search',
              status: 'completed',
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === '/api/runtime/sessions') {
      const tenant = url.searchParams.get('tenant');
      const sessions = [probeHandoffSession, probeRuntimeSession].filter((item) => !tenant || item.tenant === tenant);
      await route.fulfill({ json: { sessions } });
      return;
    }

    if (url.pathname === `/api/runtime/sessions/${probeHandoffSession.id}/messages`) {
      await route.fulfill({
        json: {
          session: probeHandoffSession,
          messages: [
            {
              id: 'handoff-user-1',
              tenant: probeTenant.id,
              entryId: 'web-bot',
              actorId: probePerson.userId,
              chatId: probeHandoffSession.chatId,
              source: 'user',
              text: '客户问 CT 设备维保状态，需要销售转维修核验',
              timestamp: Date.now() - 4000,
              botName: probeEmployee.id,
            },
            {
              id: 'handoff-bot-1',
              tenant: probeTenant.id,
              entryId: 'web-bot',
              actorId: probePerson.userId,
              chatId: probeHandoffSession.chatId,
              source: 'bot',
              text: '维修李四确认：GE16排 CT 维保有效期到 2026-12-31。',
              timestamp: Date.now() - 1000,
              botName: probeHandoffEmployee.id,
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === `/api/runtime/sessions/${probeRuntimeSession.id}/messages`) {
      await route.fulfill({
        json: {
          session: probeRuntimeSession,
          messages: [
            {
              id: 'journey-user-1',
              tenant: probeTenant.id,
              entryId: 'web-bot',
              actorId: probePerson.userId,
              chatId: probeRuntimeSession.chatId,
              source: 'user',
              text: '客户跟进需要准备报价方案',
              timestamp: Date.now() - 1000,
              botName: probeEmployee.id,
            },
            {
              id: 'journey-bot-1',
              tenant: probeTenant.id,
              entryId: 'web-bot',
              actorId: probePerson.userId,
              chatId: probeRuntimeSession.chatId,
              source: 'bot',
              text: '我会整理客户背景、报价要点和下一步跟进计划。',
              timestamp: Date.now(),
              botName: probeEmployee.id,
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === '/api/admin/harness/cases') {
      const tenant = url.searchParams.get('tenant');
      await route.fulfill({
        json: {
          fixtureDir: `tests/fixtures/harness/${tenant || probeTenant.id}`,
          cases: tenant && tenant !== probeTenant.id ? [] : [probeHarnessCase],
        },
      });
      return;
    }

    if (url.pathname === '/api/admin/harness/reports/latest') {
      await route.fulfill({ json: { report: probeHarnessReport } });
      return;
    }

    if (url.pathname === '/api/admin/harness/step-runs') {
      await route.fulfill({ json: { runs: [probeHarnessStepRun] } });
      return;
    }

    if (url.pathname === '/api/admin/harness/run-suite') {
      await route.fulfill({ json: { report: probeHarnessReport } });
      return;
    }

    if (url.pathname === '/api/admin/harness/run-step') {
      await route.fulfill({ json: { run: probeHarnessStepRun } });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unhandled probe API: ${url.pathname}` },
    });
  });
}
