import { test, expect, type Page } from '@playwright/test';
import { mockWebSocket, setupToken } from '../helpers';

type MockWsHandle = {
  sentMessages: string[];
  receiveMessage: (msg: Record<string, unknown>) => void;
};

const bots = [
  {
    name: 'acme',
    displayName: '示例医疗入口',
    status: 'running',
    channel: 'dingtalk',
    workdir: '/repo/corp/acme/agents/acme-dispatcher',
    model: 'claude-sonnet-4-6',
    tenant: 'acme',
    routingMode: 'employee-director',
    entryEmployeeId: 'acme-dispatcher',
  },
];

const baseEmployees = [
  {
    id: 'sales-zhangsan',
    displayName: '销售张三',
    description: '负责销售跟进和客户拜访',
    model: 'claude-sonnet-4-6',
    systemPrompt: '你是销售数字员工',
    tools: ['crm:search_customers'],
    skills: ['crm'],
    role: 'sales',
    capabilities: ['销售', '客户'],
    workspace: 'agents/sales-zhangsan',
    source: 'prepopulated',
    createdAt: Date.now(),
    hasFallbackLevel1: false,
    hasFallbackLevel2: false,
    toolCount: 1,
    skillCount: 1,
  },
  {
    id: 'maintenance-lisi',
    displayName: '维修李四',
    description: '负责维修工单和备件协调',
    model: 'claude-sonnet-4-6',
    systemPrompt: '你是维修数字员工',
    tools: ['repair:list_orders'],
    skills: ['repair'],
    role: 'maintenance',
    capabilities: ['维修', '工单'],
    workspace: 'agents/maintenance-lisi',
    source: 'prepopulated',
    createdAt: Date.now(),
    hasFallbackLevel1: false,
    hasFallbackLevel2: false,
    toolCount: 1,
    skillCount: 1,
  },
];

const trace = {
  id: 'trace-42',
  entryAgent: 'sales-zhangsan',
  prompt: '推进合同执行 #42',
  success: true,
  summary: '维修李四已接收设备维修子任务，准备创建维修工单、核对备件，并反馈给现场同事。',
  route: ['acme-dispatcher->sales-zhangsan', 'sales-zhangsan->maintenance-lisi'],
  handoffCount: 2,
  steps: [
    {
      from: 'acme-dispatcher',
      to: 'sales-zhangsan',
      action: 'decompose',
      task: '拆解销售跟进与客户上下文',
      reason: '销售张三职责: 客户跟进、合同推进',
      payload: {
        contract_id: 'HT-2024-001',
        contract_type: '全保维保合同',
        customer: '江山市人民医院',
        device_model: 'GE16排 CT',
        contract_amount: 1710000,
      },
      timestamp: Date.now(),
    },
    {
      from: 'sales-zhangsan',
      to: 'maintenance-lisi',
      action: 'auto_route',
      task: '拆出设备维修子任务',
      reason: '维修李四职责: 维修工单和备件协调',
      payload: {
        service_record_id: 'SR-20260516-001',
        customer: '江山市人民医院',
        device_model: 'GE16排 CT',
        billing_amount: 285000,
      },
      timestamp: Date.now(),
    },
  ],
};

const runtimeEntry = {
  id: 'web-bot',
  tenant: 'acme',
  channel: 'web',
  displayName: 'Web Entry',
  routingMode: 'employee-director',
  enabled: true,
};

const runtimeActor = {
  tenant: 'acme',
  actorId: 'u-sales-001',
  source: 'people',
  displayName: '赵六',
  peopleUserId: 'u-sales-001',
  bindings: [
    { employeeId: 'sales-zhangsan', role: 'sales', isDefault: true },
    { employeeId: 'maintenance-lisi', role: 'maintenance', isDefault: false },
  ],
};

const runtimeTargets = [
  { employeeId: 'sales-zhangsan', displayName: '销售张三', role: 'sales', isDefault: true },
  { employeeId: 'maintenance-lisi', displayName: '维修李四', role: 'maintenance', isDefault: false },
];

function workflowThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-customer-42',
    tenant: 'acme',
    sessionId: 'acme:workflow:wf-customer-42',
    entryId: 'web-bot',
    actorId: 'u-sales-001',
    ownerEmployeeId: 'sales-zhangsan',
    state: 'open',
    participants: [
      { employeeId: 'sales-zhangsan', instanceId: 'acme:workflow:wf-customer-42:sales-zhangsan', role: 'owner', joinedAt: 1 },
      { employeeId: 'maintenance-lisi', instanceId: 'acme:workflow:wf-customer-42:maintenance-lisi', role: 'participant', joinedAt: 1 },
    ],
    handoffs: [
      { fromEmployeeId: 'sales-zhangsan', toEmployeeId: 'maintenance-lisi', reason: '维修协作', status: 'requested', at: 2 },
    ],
    summary: '客户协作线程 #42',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

const collaborationCase = {
  id: 'acme:web-bot:u-sales-001:sales-zhangsan:chat-customer-42',
  tenant: 'acme',
  sessionId: 'acme:web-bot:u-sales-001:sales-zhangsan:chat-customer-42',
  entryId: 'web-bot',
  actorId: 'u-sales-001',
  chatId: 'chat-customer-42',
  state: 'active',
  currentEmployeeId: 'maintenance-lisi',
  participants: ['sales-zhangsan', 'maintenance-lisi'],
  handoffCount: 1,
  toolCallCount: 1,
  lastMessageAt: 1716100000000,
  messageCount: 2,
  preview: '客户询问维保报价，需要确认设备状态',
};

const collaborationTimeline = [
  {
    id: 'case-user-1',
    type: 'user_message',
    at: 1716099900000,
    employeeId: 'sales-zhangsan',
    text: '客户询问维保报价，需要确认设备状态',
  },
  {
    id: 'case-route-1',
    type: 'routing_decision',
    at: 1716099910000,
    employeeId: 'sales-zhangsan',
    payload: { selectedEmployee: 'sales-zhangsan' },
  },
  {
    id: 'case-handoff-1',
    type: 'handoff',
    at: 1716099920000,
    employeeId: 'sales-zhangsan',
    fromEmployeeId: 'sales-zhangsan',
    toEmployeeId: 'maintenance-lisi',
    reason: '需要维修李四确认设备维保记录',
  },
  {
    id: 'case-tool-1',
    type: 'tool_call',
    at: 1716099930000,
    employeeId: 'maintenance-lisi',
    toolName: 'maintenance.lookup_device',
    status: 'completed',
  },
  {
    id: 'case-agent-1',
    type: 'agent_message',
    at: 1716100000000,
    employeeId: 'maintenance-lisi',
    text: '设备仍在维保期内，可以按合同内维保处理。',
  },
];

async function mockApi(page: Page) {
  const employeeState = [...baseEmployees];
  const builderDraft = {
    id: 'natural-language-maintenance-qa',
    tenant: 'acme',
    source: 'natural_language',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input: { naturalLanguage: '创建一个售后质检员工' },
    employee: {
      ...baseEmployees[1],
      id: 'maintenance-qa',
      displayName: '售后质检员工',
      description: '检查维修工单质量',
      workspace: 'agents/maintenance-qa',
      allowedTargets: ['sales-zhangsan'],
    },
    validation: { ok: false, issues: [] },
  };
  const templateDraft = {
    ...builderDraft,
    id: 'template-consultant',
    source: 'template',
    input: { templateId: 'professional-service' },
    employee: {
      ...builderDraft.employee,
      id: 'consultant-agent',
      displayName: '顾问员工',
      description: '负责专业服务项目诊断和建议',
      role: 'consultant',
      workspace: 'agents/consultant-agent',
      tools: [],
      skills: [],
      allowedTargets: [],
    },
  };
  const forkDraft = {
    ...builderDraft,
    id: 'fork-sales-zhangsan',
    source: 'fork',
    input: { sourceEmployeeId: 'sales-zhangsan' },
    employee: {
      ...baseEmployees[0],
      id: 'sales-zhangsan-fork-e2e',
      displayName: '销售张三 Copy',
      workspace: 'agents/sales-zhangsan-fork-e2e',
      allowedTargets: [],
    },
  };
  const overpoweredDraft = {
    ...builderDraft,
    id: 'natural-language-overpowered',
    input: { naturalLanguage: '创建一个员工，拥有所有权限，可以删除和修改任意业务数据' },
    employee: {
      ...builderDraft.employee,
      id: 'overpowered-employee',
      displayName: '越权员工',
      description: '要求所有权限并删除任意业务数据',
      role: 'maintenance',
      workspace: 'agents/overpowered-employee',
      tools: ['med_crm:add_incident'],
    },
  };
  const brokenToolDraft = {
    ...builderDraft,
    id: 'manual-broken-tool',
    source: 'manual',
    employee: {
      ...builderDraft.employee,
      id: 'broken-tool-agent',
      displayName: '待修正员工',
      tools: ['med_crm:missing_tool'],
      workspace: 'agents/broken-tool-agent',
    },
  };
  const builderDrafts = [builderDraft];
  let workflows = [workflowThread()];
  const peopleState = [
    {
      userId: 'u-sales-001',
      name: '赵六',
      departments: [{ id: '1', name: '杭州示例医疗器械有限公司' }],
      status: 'active',
      source: 'dingtalk',
      syncedAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      userId: 'u-maint-002',
      name: '沈杨',
      departments: [{ id: '1', name: '杭州示例医疗器械有限公司' }],
      role: 'maintenance',
      assistantId: 'maintenance-lisi',
      status: 'active',
      source: 'dingtalk',
      syncedAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === '/api/setup/status') {
      await route.fulfill({ json: {
        configured: true,
        needsApiKey: false,
        hasBots: true,
        steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true },
      } });
      return;
    }
    if (url.pathname === '/api/health') {
      await route.fulfill({ json: { status: 'ok', bots } });
      return;
    }
    if (url.pathname === '/api/tenants') {
      await route.fulfill({
        json: method === 'POST'
          ? { tenant: 'acme-med', displayName: 'Acme 医疗', dir: '/repo/corp/acme-med' }
          : { tenants: [{ id: 'acme', displayName: '示例医疗' }] },
      });
      return;
    }
    if (url.pathname === '/api/workdirs') {
      await route.fulfill({
        json: [
          {
            id: 'web-bot',
            displayName: 'Web Entry',
            path: '/repo/corp/acme/agents/web-entry',
            channels: ['web'],
            status: 'active',
            tenant: 'acme',
          },
          {
            id: 'sales-zhangsan',
            displayName: '销售张三',
            path: '/repo/corp/acme/agents/sales-zhangsan',
            channels: ['feishu'],
            status: 'active',
            tenant: 'acme',
          },
        ],
      });
      return;
    }
    if (url.pathname === '/api/runtime/entries') {
      await route.fulfill({ json: { entries: [runtimeEntry] } });
      return;
    }
    if (url.pathname === '/api/runtime/actors') {
      await route.fulfill({ json: { actors: [runtimeActor] } });
      return;
    }
    if (url.pathname === '/api/runtime/targets') {
      await route.fulfill({ json: { targets: runtimeTargets } });
      return;
    }
    if (url.pathname === '/api/runtime/sessions') {
      await route.fulfill({ json: { sessions: [] } });
      return;
    }
    if (url.pathname === '/api/runtime/cases') {
      await route.fulfill({ json: { cases: [collaborationCase] } });
      return;
    }
    if (url.pathname === `/api/runtime/cases/${encodeURIComponent(collaborationCase.id)}/timeline`) {
      await route.fulfill({ json: { case: collaborationCase, timeline: collaborationTimeline } });
      return;
    }
    if (url.pathname === '/api/runtime/workflows') {
      if (method === 'POST') {
        const body = route.request().postDataJSON() as {
          title?: string;
          summary?: string;
          ownerEmployeeId: string;
          participantEmployeeIds?: string[];
        };
        const created = workflowThread({
          id: `wf-created-${workflows.length + 1}`,
          ownerEmployeeId: body.ownerEmployeeId,
          participants: [
            { employeeId: body.ownerEmployeeId, instanceId: `acme:workflow:created:${body.ownerEmployeeId}`, role: 'owner', joinedAt: Date.now() },
            ...(body.participantEmployeeIds ?? []).map((employeeId) => ({
              employeeId,
              instanceId: `acme:workflow:created:${employeeId}`,
              role: 'participant',
              joinedAt: Date.now(),
            })),
          ],
          summary: body.summary || body.title || '客户协作线程',
          handoffs: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        workflows = [created, ...workflows];
        await route.fulfill({ status: 201, json: { workflow: created, session: null } });
        return;
      }
      await route.fulfill({ json: { workflows } });
      return;
    }
    if (url.pathname.startsWith('/api/runtime/workflows/')) {
      const parts = url.pathname.split('/');
      const workflowId = decodeURIComponent(parts[4] ?? '');
      const action = parts[5];
      const currentWorkflow = workflows.find((item) => item.id === workflowId) ?? workflows[0];
      if (method === 'POST' && action === 'handoff') {
        const body = route.request().postDataJSON() as { fromEmployeeId: string; toEmployeeId: string; reason?: string };
        const next = {
          ...currentWorkflow,
          participants: currentWorkflow.participants.some((item) => item.employeeId === body.toEmployeeId)
            ? currentWorkflow.participants
            : [
                ...currentWorkflow.participants,
                { employeeId: body.toEmployeeId, instanceId: `acme:workflow:${workflowId}:${body.toEmployeeId}`, role: 'participant', joinedAt: Date.now() },
              ],
          handoffs: [...currentWorkflow.handoffs, { ...body, status: 'requested', at: Date.now() }],
          updatedAt: Date.now(),
        };
        workflows = workflows.map((item) => item.id === currentWorkflow.id ? next : item);
        await route.fulfill({ json: { workflow: next } });
        return;
      }
      if (method === 'POST' && action === 'messages') {
        const next = { ...currentWorkflow, updatedAt: Date.now() };
        workflows = workflows.map((item) => item.id === currentWorkflow.id ? next : item);
        await route.fulfill({ json: { workflow: next, session: null, reply: 'Workflow 已推进，维修李四会补充维修判断。' } });
        return;
      }
      await route.fulfill({ json: { workflow: currentWorkflow, session: null } });
      return;
    }
    if (url.pathname === '/api/employees') {
      await route.fulfill({ json: { employees: employeeState } });
      return;
    }
    if (url.pathname === '/api/templates') {
      await route.fulfill({
        json: {
          templates: [
            { id: 'med-device', name: '医疗器械', description: '医疗设备服务模板', employeeCount: 3 },
            { id: 'professional-service', name: '专业服务', description: '顾问服务模板', employeeCount: 1 },
          ],
        },
      });
      return;
    }
    if (url.pathname === '/api/agent-builder/drafts' && method === 'GET') {
      await route.fulfill({ json: { drafts: builderDrafts } });
      return;
    }
    if (url.pathname === '/api/agent-builder/options') {
      await route.fulfill({
        json: {
          tenant: 'acme',
          skills: [{ name: 'med_crm', displayName: '医疗 CRM', description: '医疗设备服务工具', toolCount: 2 }],
          tools: [
            { name: 'med_crm:list_maintenance', appName: 'med_crm', description: '查询维保合同', riskLevel: 'read' },
            { name: 'med_crm:add_incident', appName: 'med_crm', description: '新增维修工单', riskLevel: 'internal_write' },
          ],
          employees: employeeState.map((item) => ({ id: item.id, displayName: item.displayName, role: item.role, workspace: item.workspace })),
        },
      });
      return;
    }
    if (url.pathname === '/api/agent-builder/drafts' && method === 'POST') {
      const body = route.request().postDataJSON() as { source?: string; prompt?: string; templateId?: string };
      const base = body.source === 'template'
        ? templateDraft
        : body.source === 'fork'
          ? forkDraft
          : body.source === 'manual'
            ? brokenToolDraft
            : body.prompt?.includes('所有权限') || body.prompt?.includes('删除')
              ? overpoweredDraft
              : builderDraft;
      const next = { ...base, id: `${base.id}-${builderDrafts.length}`, createdAt: Date.now(), updatedAt: Date.now() };
      builderDrafts.unshift(next);
      await route.fulfill({ status: 201, json: { draft: next } });
      return;
    }
    if (url.pathname.startsWith('/api/agent-builder/drafts/')) {
      const parts = url.pathname.split('/');
      const draftId = decodeURIComponent(parts[4] ?? '');
      const action = parts[5];
      const current = builderDrafts.find((item) => item.id === draftId) ?? builderDrafts[0];
      if (method === 'PUT') {
        const next = route.request().postDataJSON() as typeof builderDraft;
        const index = builderDrafts.findIndex((item) => item.id === draftId);
        if (index >= 0) builderDrafts[index] = next;
        await route.fulfill({ json: { draft: next } });
        return;
      }
      if (method === 'POST' && action === 'validate') {
        current.validation = current.employee.tools.includes('med_crm:missing_tool')
          ? { ok: false, issues: [{ severity: 'error', field: 'employee.tools', message: 'Tool is not registered: med_crm:missing_tool' }] }
          : current.employee.id.includes('overpowered')
            ? { ok: false, issues: [{ severity: 'error', field: 'employee.tools', message: 'Role maintenance is not allowed to call med_crm:delete_contract' }] }
            : { ok: true, issues: [] };
        current.status = current.validation.ok ? 'validated' : 'draft';
        await route.fulfill({ json: { draft: current, validation: current.validation } });
        return;
      }
      if (method === 'POST' && action === 'test') {
        if (!current.validation.ok || current.employee.tools.includes('med_crm:missing_tool')) {
          current.validation = { ok: false, issues: [{ severity: 'error', field: 'employee.tools', message: 'Tool is not registered: med_crm:missing_tool' }] };
          await route.fulfill({ status: 409, json: { error: 'Draft has validation errors', draft: current, validation: current.validation } });
          return;
        }
        current.status = 'tested';
        current.validation = { ok: true, issues: [] };
        current.harness = { yaml: 'id: agent-builder-e2e', lastResult: 'passed', failures: [] };
        await route.fulfill({ json: { draft: current, result: { status: 'passed', failures: [] } } });
        return;
      }
      if (method === 'POST' && action === 'sandbox' && parts[6] === 'messages') {
        current.sandbox = {
          lastSessionId: `acme:builder_sandbox:${current.id}:builder-web:builder-${current.id}`,
          lastResult: 'passed',
          reply: '沙盒试聊通过，草稿员工按预期回答。',
          fingerprint: 'e2e',
        };
        await route.fulfill({
          json: {
            draft: current,
            reply: '沙盒试聊通过，草稿员工按预期回答。',
            trace: { input: { channel: 'builder_sandbox', botName: current.employee.id }, runtime: { mode: 'builder_sandbox' } },
            session: {
              id: current.sandbox.lastSessionId,
              tenant: 'acme',
              entryId: `builder-sandbox:${current.id}`,
              channel: 'builder_sandbox',
              actorId: 'builder-web',
              chatId: `builder-${current.id}`,
              employeeId: current.employee.id,
              instanceId: `builder:${current.id}`,
              workdir: `/repo/data/agent-builder/sandbox/acme/${current.id}/builder-web`,
              sdkSessionScope: current.sandbox.lastSessionId,
              mode: 'builder_sandbox',
              createdAt: 1,
              updatedAt: 2,
            },
          },
        });
        return;
      }
      if (method === 'POST' && action === 'publish') {
        current.status = 'published';
        await route.fulfill({ json: { draft: current, yamlPath: '/repo/corp/acme/employees/maintenance-qa.yaml', workspacePath: '/repo/corp/acme/agents/maintenance-qa', colonyRegistered: true } });
        return;
      }
    }
    if (url.pathname === '/api/enterprise-people') {
      await route.fulfill({ json: { people: peopleState } });
      return;
    }
    if (url.pathname === '/api/enterprise-people/sync') {
      await route.fulfill({
        json: { people: peopleState, sync: { created: 0, updated: peopleState.length, inactive: 0, total: peopleState.length } },
      });
      return;
    }
    if (url.pathname.startsWith('/api/enterprise-people/') && url.pathname.endsWith('/bind')) {
      const userId = decodeURIComponent(url.pathname.split('/')[3] ?? '');
      const body = route.request().postDataJSON() as {
        role?: string | null;
        assistantId?: string | null;
        entryEmployee?: string;
        routingMode?: 'bound' | 'selector';
        visibleEmployees?: string[];
      };
      const person = peopleState.find((item) => item.userId === userId);
      if (!person) {
        await route.fulfill({ status: 404, json: { error: 'Person not found' } });
        return;
      }
      if ('role' in body) {
        if (body.role) person.role = body.role;
        else delete person.role;
      }
      if ('assistantId' in body) {
        if (body.assistantId) person.assistantId = body.assistantId;
        else delete person.assistantId;
      }
      if ('entryEmployee' in body) {
        if (body.entryEmployee) {
          person.entryEmployee = body.entryEmployee;
          person.routingMode = body.routingMode || 'bound';
          person.visibleEmployees = body.visibleEmployees || [];
        } else {
          delete person.entryEmployee;
          delete person.routingMode;
          delete person.visibleEmployees;
        }
      }
      person.updatedAt = Date.now();
      await route.fulfill({ json: { person } });
      return;
    }
    if (url.pathname === '/api/employees/stats') {
      await route.fulfill({
        json: { stats: { totalAgents: employeeState.length, totalSkills: 2, totalFallbacks: 0, agentsByRole: { sales: 1, maintenance: 1 } } },
      });
      return;
    }
    if (url.pathname === '/api/employees/templates') {
      await route.fulfill({
        json: {
          templates: [
            { role: 'sales', hasWorkdir: true, hasRoleTemplate: true },
            { role: 'maintenance', hasWorkdir: true, hasRoleTemplate: true },
            { role: 'finance', hasWorkdir: false, hasRoleTemplate: true },
          ],
        },
      });
      return;
    }
    if (url.pathname === '/api/employees/fork') {
      const body = route.request().postDataJSON() as { personName: string; personRole: string; humanUserId?: string };
      const forked = { ...employeeState[0], id: 'sales-zhangsan-fork-e2e', displayName: body.personName, role: body.personRole, humanUserId: body.humanUserId, source: 'forked' };
      employeeState.push(forked);
      await route.fulfill({
        json: { agent: forked },
      });
      return;
    }
    if (url.pathname === '/api/employees/generate') {
      await route.fulfill({ json: { agent: employeeState[0], warnings: [], rawYaml: '' } });
      return;
    }
    if (url.pathname === '/api/orchestration/traces' || url.pathname === '/api/employees/traces') {
      await route.fulfill({ json: { traces: [trace] } });
      return;
    }
    if (url.pathname.startsWith('/api/admin/workdir')) {
      await route.fulfill({ json: { path: '/repo/corp/acme/agents/sales-zhangsan', apps: [] } });
      return;
    }
    if (url.pathname.startsWith('/api/admin/analytics') || url.pathname === '/api/chats') {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname === '/api/admin/session') {
      await route.fulfill({ json: { authenticated: true, mode: 'protected' } });
      return;
    }

    await route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.title.includes('login guard')) {
    await setupToken(page);
  }
  await mockWebSocket(page);
  await mockApi(page);
});

test.describe('v2 product journey', () => {
  test('login guard verifies admin token before entering console', async ({ page }) => {
    await page.route('**/api/admin/session', async (route) => {
      const auth = route.request().headers().authorization;
      await route.fulfill(auth ? { json: { authenticated: true, mode: 'protected' } } : { status: 401, json: { error: 'Unauthorized' } });
    });

    await page.goto('/people');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
    await page.getByLabel('管理员令牌').fill('valid-admin-token');
    await page.getByRole('button', { name: '进入控制台' }).click();
    await expect(page).toHaveURL('/people');
    await expect(page.getByRole('heading', { name: '企业员工' })).toBeVisible();
  });

  test('navigation reflects runtime, employee, and system layers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '概览' })).toBeVisible();

    const nav = page.getByRole('navigation');
    await expect(page.getByText('日常工作', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '对话' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '会话' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '多员工工作流' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '知识库' })).toBeVisible();
    await expect(page.getByText('员工与能力', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '员工 Builder' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '数字员工' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '企业员工' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '技能市场' })).toBeVisible();
    await expect(page.getByText('系统', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '概览' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '配置' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '记忆' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '验收' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '入口路由' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: '人员绑定' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: '员工网络' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '新建企业' })).toBeVisible();
  });

  test('agent builder creates and promotes a draft through validation gates', async ({ page }) => {
    await page.goto('/agent-builder');
    await expect(page.getByRole('heading', { name: '数字员工 Builder' })).toBeVisible();
    await expect(page.locator('input[value="售后质检员工"]')).toBeVisible();
    await expect(page.getByText('agents/maintenance-qa')).toBeVisible();

    await page.getByRole('button', { name: '生成草稿' }).click();
    await expect(page.getByText('草稿已创建')).toBeVisible();
    await page.getByRole('button', { name: '校验' }).click();
    await expect(page.getByText('校验完成')).toBeVisible();
    await page.getByRole('button', { name: '测试' }).click();
    await expect(page.getByText('Harness passed')).toBeVisible();
    await page.getByRole('button', { name: '沙盒试聊' }).click();
    await expect(page.getByText('沙盒试聊已写入 Runtime Session')).toBeVisible();
    await expect(page.getByText('沙盒试聊通过，草稿员工按预期回答。')).toBeVisible();
    await page.getByRole('button', { name: '发布' }).click();
    await page.getByRole('button', { name: '确认发布' }).click();
    await expect(page.getByText('数字员工已发布')).toBeVisible();
    await expect(page.getByText('发布成功：maintenance-qa')).toBeVisible();
    await expect(page.getByRole('link', { name: '绑定人员' })).toBeVisible();
  });

  test('agent builder supports template and fork draft sources', async ({ page }) => {
    await page.goto('/agent-builder');
    await expect(page.getByRole('heading', { name: '数字员工 Builder' })).toBeVisible();

    await page.getByRole('button', { name: '模板' }).click();
    await page.locator('select').selectOption('med-device');
    await page.getByRole('textbox', { name: '角色' }).first().fill('consultant');
    await page.getByRole('button', { name: '生成草稿' }).click();
    await expect(page.locator('input[value="顾问员工"]')).toBeVisible();
    await expect(page.getByText('agents/consultant-agent')).toBeVisible();

    await page.getByRole('button', { name: '复制' }).click();
    await page.getByRole('button', { name: '生成草稿' }).click();
    await expect(page.locator('input[value="销售张三 Copy"]')).toBeVisible();
    await expect(page.getByText('agents/sales-zhangsan-fork-e2e')).toBeVisible();
  });

  test('agent builder blocks overpowered drafts before publish', async ({ page }) => {
    await page.goto('/agent-builder');
    await page.getByLabel('需求').fill('创建一个员工，拥有所有权限，可以删除和修改任意业务数据');
    await page.getByRole('button', { name: '生成草稿' }).click();
    await expect(page.locator('input[value="越权员工"]')).toBeVisible();
    await page.getByRole('button', { name: '校验' }).click();
    await expect(page.getByText(/not allowed/)).toBeVisible();
    await expect(page.getByRole('button', { name: '发布' })).toBeDisabled();
  });

  test('agent builder recovers from validation failure after fixing tool selection', async ({ page }) => {
    await page.goto('/agent-builder');
    await page.getByRole('button', { name: '空白', exact: true }).click();
    await page.getByRole('button', { name: '生成草稿' }).click();
    await expect(page.locator('input[value="待修正员工"]')).toBeVisible();
    await page.getByRole('button', { name: '校验' }).click();
    await expect(page.getByText('Tool is not registered: med_crm:missing_tool')).toBeVisible();

    await page.getByRole('button', { name: '移除 med_crm:missing_tool' }).click();
    await page.getByLabel(/查询维保合同/).check();
    await page.getByRole('button', { name: '保存配置' }).click();
    await page.getByRole('button', { name: '校验' }).click();
    await expect(page.getByText('校验完成')).toBeVisible();
    await page.getByRole('button', { name: '测试' }).click();
    await expect(page.getByText('Harness passed')).toBeVisible();
  });

  test('onboarding creates an enterprise tenant', async ({ page }) => {
    await page.goto('/onboarding');
    await page.getByLabel('企业标识 *').fill('acme-med');
    await page.getByLabel('企业名称 *').fill('Acme 医疗');
    await page.getByLabel('企业描述').fill('医疗设备销售与维修服务');
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByText('管理员 (admin)')).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByLabel('数字员工描述').fill('负责合同执行的销售数字员工');
    await page.getByRole('button', { name: '完成创建' }).click();
    await expect(page).toHaveURL('/employees');
  });

  test('employees page shows the published employee directory and links creation to Builder', async ({ page }) => {
    await page.goto('/employees');
    await expect(page.getByRole('heading', { name: '数字员工', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '去 Builder 构造' })).toBeVisible();
    await expect(page.getByText('员工能力目录')).toBeVisible();
    await expect(page.getByText('Prompt 组成视图').first()).toBeVisible();
    await expect(page.getByText('销售张三').first()).toBeVisible();
  });

  test('orchestration page shows collaboration logs from runtime conversations', async ({ page }) => {
    await page.goto('/orchestration');
    await expect(page.getByRole('heading', { name: '协同日志', exact: true })).toBeVisible();
    await expect(page.getByText('客户询问维保报价，需要确认设备状态').first()).toBeVisible();
    await expect(page.getByText('员工协同')).toBeVisible();
    await expect(page.getByText(/需要维修李四确认设备维保记录/)).toBeVisible();
    await expect(page.getByText('工具 maintenance.lookup_device')).toBeVisible();
    await expect(page.getByText('设备仍在维保期内，可以按合同内维保处理。')).toBeVisible();
  });

  test('enterprise people page assigns a role and personal assistant', async ({ page }) => {
    await page.goto('/people');
    await expect(page.getByRole('heading', { name: '企业员工' })).toBeVisible();
    await expect(page.getByText('赵六')).toBeVisible();
    await expect(page.getByText('沈杨')).toBeVisible();

    await page.getByLabel('设置 赵六 的角色').selectOption('sales');
    await page.getByLabel('绑定 赵六 的个人助手').selectOption('sales-zhangsan');

    await expect(page.getByLabel('设置 赵六 的角色')).toHaveValue('sales');
    await expect(page.getByLabel('绑定 赵六 的个人助手')).toHaveValue('sales-zhangsan');
  });

  test('legacy entry routing URL redirects to Config', async ({ page }) => {
    await page.goto('/entry-routing');
    await expect(page).toHaveURL('/config');
    await expect(page.getByRole('heading', { name: '配置' }).first()).toBeVisible();
  });

  test('chat page supports two-turn conversation through enterprise entry', async ({ page }) => {
    await page.goto('/chat/web-bot');
    await expect(page.getByText('已连接')).toBeVisible();

    await page.getByPlaceholder('输入消息... (Enter 发送)').fill('我是赵六，帮我看下今天的销售跟进');
    await page.keyboard.press('Enter');
    await page.evaluate(() => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      const msg = JSON.parse(ws.sentMessages[0]);
      const botName = msg.target?.employeeId ?? 'sales-zhangsan';
      const meta = {
        tenant: msg.tenant,
        entryId: msg.entryId,
        actorId: msg.actorId,
        employeeId: botName,
        sessionId: `${msg.tenant}:${msg.entryId}:${msg.actorId}:${botName}:${msg.chatId}`,
        instanceId: `${msg.tenant}:${msg.actorId}:${botName}`,
        workdir: `/repo/corp/acme/agents/${botName}/${msg.actorId}`,
        sdkSessionScope: `${msg.tenant}:${msg.entryId}:${msg.actorId}:${botName}:${msg.chatId}`,
        mode: 'single_employee',
      };
      ws.receiveMessage({
        type: 'new_message',
        botName,
        chatId: msg.chatId,
        meta,
        message: {
          id: 'journey-user-1',
          chatId: msg.chatId,
          text: msg.content,
          source: 'user',
          botName,
          timestamp: Date.now(),
        },
      });
      ws.receiveMessage({
        type: 'new_message',
        botName,
        chatId: msg.chatId,
        meta,
        message: {
          id: 'journey-bot-1',
          chatId: msg.chatId,
          text: '已由示例医疗入口接收，会先交给 acme-dispatcher 分析。',
          source: 'bot',
          botName,
          timestamp: Date.now() + 1,
        },
      });
    });
    await expect(page.getByText('我是赵六，帮我看下今天的销售跟进')).toBeVisible();
    await expect(page.getByText('已由示例医疗入口接收，会先交给 acme-dispatcher 分析。')).toBeVisible();

    await page.getByPlaceholder('输入消息... (Enter 发送)').fill('客户说设备需要维修，应该转给谁');
    await page.keyboard.press('Enter');
    await page.evaluate(() => {
      const ws = (window as unknown as { __mockWs: MockWsHandle }).__mockWs;
      const msg = JSON.parse(ws.sentMessages[1]);
      const botName = msg.target?.employeeId ?? 'sales-zhangsan';
      const meta = {
        tenant: msg.tenant,
        entryId: msg.entryId,
        actorId: msg.actorId,
        employeeId: botName,
        sessionId: `${msg.tenant}:${msg.entryId}:${msg.actorId}:${botName}:${msg.chatId}`,
        instanceId: `${msg.tenant}:${msg.actorId}:${botName}`,
        workdir: `/repo/corp/acme/agents/${botName}/${msg.actorId}`,
        sdkSessionScope: `${msg.tenant}:${msg.entryId}:${msg.actorId}:${botName}:${msg.chatId}`,
        mode: 'single_employee',
      };
      ws.receiveMessage({
        type: 'new_message',
        botName,
        chatId: msg.chatId,
        meta,
        message: {
          id: 'journey-user-2',
          chatId: msg.chatId,
          text: msg.content,
          source: 'user',
          botName,
          timestamp: Date.now(),
        },
      });
      ws.receiveMessage({
        type: 'new_message',
        botName,
        chatId: msg.chatId,
        meta,
        message: {
          id: 'journey-bot-2',
          chatId: msg.chatId,
          text: '已由示例医疗入口识别维修诉求，路由到 maintenance-lisi。',
          source: 'bot',
          botName,
          timestamp: Date.now() + 1,
        },
      });
    });
    await expect(page.getByText('客户说设备需要维修，应该转给谁')).toBeVisible();
    await expect(page.getByText('已由示例医疗入口识别维修诉求，路由到 maintenance-lisi。')).toBeVisible();

    const sent = await page.evaluate(() => {
      const ws = (window as unknown as { __mockWs?: MockWsHandle }).__mockWs;
      return ws?.sentMessages.map((item) => JSON.parse(item)) ?? [];
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ type: 'send_message', tenant: 'acme', entryId: 'web-bot', actorId: 'u-sales-001' });
    expect(sent[1]).toMatchObject({ type: 'send_message', tenant: 'acme', entryId: 'web-bot', actorId: 'u-sales-001' });
  });
});
