import { test, expect, type Route } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createJourneyReport } from '../reporting';
import { setupProbeConsole } from '../probe-helpers';

const tenant = 'acme-happycompany';
const now = Date.now();

const flowACase = {
  id: 'acme-bid-win-to-contract-intake',
  description: '销售跟进杭州示例医疗中标，交财务录入合同，并创建维修定时任务。',
  file: 'acme-bid-win-to-contract-intake.yaml',
  input: { channel: 'harness', botName: 'sales-zhangsan', tenant, userId: 'acme-operator' },
  expect: { routedEmployee: 'sales-zhangsan', noErrors: true },
};

const flowBCase = {
  id: 'acme-maintenance-schedule-dispatch-to-receipt',
  description: '维保定时任务触发后，财务派单维修，维修生成回执并反馈财务。',
  file: 'acme-maintenance-schedule-dispatch-to-receipt.yaml',
  input: { channel: 'harness', botName: 'finance-wangwu', tenant, userId: 'acme-operator' },
  expect: { routedEmployee: 'finance-wangwu', noErrors: true },
};

const flowAResult = {
  case: {
    ...flowACase,
    input: {
      ...flowACase.input,
      chatId: 'harness-acme-bid-win-to-contract-intake',
      text: '跟进杭州示例医疗近期中标项目，确认中标后交给财务录入合同，并根据合同维修周期创建维修定时任务。',
    },
  },
  status: 'passed' as const,
  failures: [],
  ingress: {
    reply: '已确认杭州示例医疗中标记录，合同待补齐；已交给财务王五录入合同，并生成半年维保计划。',
    trace: {
      input: {
        channel: 'harness',
        botName: 'sales-zhangsan',
        tenant,
        userId: 'acme-operator',
        chatId: 'harness-acme-bid-win-to-contract-intake',
      },
      routing: { selectedEmployee: 'sales-zhangsan' },
      runtime: { tenant },
      toolCalls: [
        { name: 'med_crm:search_bids', status: 'complete', elapsedMs: 45 },
        { name: 'med_crm:contract_intake', status: 'complete', elapsedMs: 80 },
        { name: 'scheduler:create_task', status: 'complete', elapsedMs: 35 },
      ],
      memory: [
        { operation: 'append', subject: 'bid:330382263180160000008-WZLCZB-2026-03047', workspace: '/corp/acme-happycompany/agents/sales-zhangsan/memory', status: 'ok' },
        { operation: 'append', subject: 'contract:jsrm-540ct-full-service', workspace: '/corp/acme-happycompany/agents/finance-wangwu/memory', status: 'ok' },
      ],
      handoffs: [
        { from: 'sales-zhangsan', to: 'finance-wangwu', reason: '中标后合同录入和维修周期解析' },
      ],
      businessArtifacts: [
        { type: 'bid_win', id: '330382263180160000008-WZLCZB-2026-03047', status: 'created' },
        { type: 'contract_intake', id: 'jsrm-540ct-full-service', status: 'created' },
        { type: 'maintenance_schedule', id: 'schedule-jsrm-540ct-half-yearly', status: 'created' },
      ],
      errors: [],
      startedAt: now - 5000,
      finishedAt: now - 4500,
    },
  },
};

const flowBResult = {
  case: {
    ...flowBCase,
    input: {
      ...flowBCase.input,
      chatId: 'harness-acme-maintenance-schedule-dispatch-to-receipt',
      text: '触发江山市人民医院 GE16排 CT 半年维保任务，请财务派单维修李四，维修完成后记录日志和回执并反馈财务。',
    },
  },
  status: 'passed' as const,
  failures: [],
  ingress: {
    reply: '维保定时任务已触发，财务王五已派单维修李四；维修李四完成现场维保，生成 SERVICE RECORD 回执 sr-jsrm-540ct-001，并已反馈财务。',
    trace: {
      input: {
        channel: 'harness',
        botName: 'finance-wangwu',
        tenant,
        userId: 'acme-operator',
        chatId: 'harness-acme-maintenance-schedule-dispatch-to-receipt',
      },
      routing: { selectedEmployee: 'finance-wangwu' },
      runtime: { tenant },
      toolCalls: [
        { name: 'scheduler:trigger_task', status: 'complete', elapsedMs: 30 },
        { name: 'med_crm:list_maintenance', status: 'complete', elapsedMs: 45 },
        { name: 'manual:lookup', status: 'complete', elapsedMs: 60 },
        { name: 'med_crm:add_incident', status: 'complete', elapsedMs: 70 },
        { name: 'med_crm:create_service_record', status: 'complete', elapsedMs: 95 },
        { name: 'med_crm:finance_settlement', status: 'complete', elapsedMs: 50 },
      ],
      memory: [
        { operation: 'search', subject: 'contract:jsrm-540ct-full-service', workspace: '/corp/acme-happycompany/agents/finance-wangwu/memory', status: 'ok' },
        { operation: 'append', subject: 'service_record:sr-jsrm-540ct-001', workspace: '/corp/acme-happycompany/agents/maintenance-lisi/memory', status: 'ok' },
      ],
      handoffs: [
        { from: 'finance-wangwu', to: 'maintenance-lisi', reason: '维保定时任务触发后派单' },
        { from: 'maintenance-lisi', to: 'finance-wangwu', reason: 'SERVICE RECORD 回执完成后反馈财务' },
      ],
      businessArtifacts: [
        { type: 'maintenance_task', id: 'task-jsrm-540ct-2026h2', status: 'triggered' },
        { type: 'maintenance_dispatch', id: 'dispatch-jsrm-540ct-lisi', status: 'created' },
        { type: 'service_record', id: 'sr-jsrm-540ct-001', status: 'created' },
        { type: 'finance_settlement', id: 'settlement-jsrm-540ct-sr-001', status: 'created' },
      ],
      errors: [],
      startedAt: now - 3000,
      finishedAt: now - 2500,
    },
  },
};

const harnessReport = {
  id: 'acme-ultimate-acceptance-report',
  createdAt: new Date(now).toISOString(),
  summary: { passed: 2, failed: 0, total: 2 },
  text: '2 passed, 0 failed',
  results: [flowAResult, flowBResult],
};

const acmeEmployees = [
  {
    id: 'sales-zhangsan',
    displayName: '销售张三',
    description: '负责招标跟进和客户机会推进。',
    role: 'sales',
    skills: ['med_crm'],
    tools: ['med_crm:search_bids'],
    model: 'claude-sonnet-4-6',
    workspace: 'agents/sales-zhangsan',
    source: 'generated',
    tenantName: tenant,
  },
  {
    id: 'finance-wangwu',
    displayName: '财务王五',
    description: '负责合同录入、维修周期解析和结算归档。',
    role: 'finance',
    skills: ['med_crm'],
    tools: ['med_crm:contract_intake', 'med_crm:finance_settlement'],
    model: 'claude-sonnet-4-6',
    workspace: 'agents/finance-wangwu',
    source: 'generated',
    tenantName: tenant,
  },
  {
    id: 'maintenance-lisi',
    displayName: '维修李四',
    description: '负责现场维保、说明书查询和 SERVICE RECORD 回执。',
    role: 'maintenance',
    skills: ['med_crm'],
    tools: ['med_crm:create_service_record'],
    model: 'claude-sonnet-4-6',
    workspace: 'agents/maintenance-lisi',
    source: 'generated',
    tenantName: tenant,
  },
];

const memorySources: Record<string, Array<{ file: string; type: string; size: number }>> = {
  'finance-wangwu': [{ file: '2026-06-04.md', type: 'date', size: 353 }],
  'maintenance-lisi': [{ file: '2026-06-04.md', type: 'date', size: 318 }],
};

const memoryFiles: Record<string, string> = {
  'finance-wangwu': [
    '# Acme Flow A contract memory',
    '客户: 江山市人民医院',
    '设备: GE16排 CT',
    '合同: jsrm-540ct-full-service',
    '维保周期: 每半年一次',
    '付款规则: 每服务满半年并验收合格后付款',
    '需要跟进: 杭州示例医疗中标项目 330382263180160000008-WZLCZB-2026-03047 合同链接缺失时由销售补齐。',
  ].join('\n'),
  'maintenance-lisi': [
    '# Acme Flow B service memory',
    '维修任务: task-jsrm-ge16ct-2026h2',
    'SERVICE RECORD: sr-jsrm-540ct-001',
    '现场结论: GE16排 CT 半年维保完成，扫描床和高压系统检查正常。',
    '客户签字: yes',
    '财务回传: settlement-jsrm-540ct-sr-001 可按合同付款规则归档。',
  ].join('\n'),
};

const flowBWorkflowCase = {
  id: 'case-acme-maintenance-receipt',
  tenant,
  sessionId: 'session-acme-maintenance-receipt',
  entryId: 'web-bot',
  actorId: 'acme-operator',
  chatId: 'chat-acme-maintenance-receipt',
  title: '维保定时任务到维修回执',
  state: 'completed',
  currentEmployeeId: 'finance-wangwu',
  participants: ['finance-wangwu', 'maintenance-lisi'],
  handoffCount: 2,
  toolCallCount: 6,
  lastMessageAt: now,
  messageCount: 4,
  preview: '维保定时任务触发，财务派单维修李四并回收 SERVICE RECORD。',
};

const flowBTimeline = [
  {
    id: 'tl-trigger',
    type: 'business_artifact',
    at: now - 5000,
    employeeId: 'finance-wangwu',
    status: 'triggered',
    artifactType: 'maintenance_task',
    artifactId: 'task-jsrm-540ct-2026h2',
  },
  {
    id: 'tl-dispatch',
    type: 'handoff',
    at: now - 4000,
    employeeId: 'finance-wangwu',
    fromEmployeeId: 'finance-wangwu',
    toEmployeeId: 'maintenance-lisi',
    reason: '维保定时任务触发后派单',
  },
  {
    id: 'tl-manual',
    type: 'tool_call',
    at: now - 3000,
    employeeId: 'maintenance-lisi',
    toolName: 'manual:lookup',
    status: 'completed',
  },
  {
    id: 'tl-record',
    type: 'business_artifact',
    at: now - 2000,
    employeeId: 'maintenance-lisi',
    status: 'created',
    artifactType: 'service_record',
    artifactId: 'sr-jsrm-540ct-001',
  },
  {
    id: 'tl-finance',
    type: 'business_artifact',
    at: now - 1000,
    employeeId: 'finance-wangwu',
    status: 'created',
    artifactType: 'finance_settlement',
    artifactId: 'settlement-jsrm-540ct-sr-001',
  },
];

interface AcceptanceArtifact {
  type: string;
  id: string;
  status: string;
}

interface AcceptanceReport {
  status: string;
  artifactCounts: Record<string, number>;
  flows: Array<{
    id: string;
    status: string;
    artifacts: AcceptanceArtifact[];
  }>;
}

function runRealCliAcceptance(outputPath: string): AcceptanceReport {
  const repoRoot = path.resolve(process.cwd(), '..');
  const scriptPath = path.join(repoRoot, 'scripts', 'run-acme-ultimate-acceptance.mjs');
  const result = spawnSync('node', [scriptPath, '--output', outputPath], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`real CLI acceptance failed\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(readFileSync(outputPath, 'utf-8')) as AcceptanceReport;
}

function applyRealCliArtifacts(report: AcceptanceReport): void {
  const flowA = report.flows.find((flow) => flow.id === flowACase.id);
  const flowB = report.flows.find((flow) => flow.id === flowBCase.id);
  if (!flowA || !flowB) throw new Error('real CLI acceptance report is missing Acme flows');
  flowAResult.ingress.trace.businessArtifacts = flowA.artifacts;
  flowBResult.ingress.trace.businessArtifacts = [
    { type: 'maintenance_task', id: 'task-jsrm-540ct-2026h2', status: 'triggered' },
    { type: 'maintenance_dispatch', id: 'dispatch-jsrm-540ct-lisi', status: 'created' },
    ...flowB.artifacts,
  ];
  const serviceRecord = flowB.artifacts.find((artifact) => artifact.type === 'service_record');
  const settlement = flowB.artifacts.find((artifact) => artifact.type === 'finance_settlement');
  if (serviceRecord) {
    const recordEvent = flowBTimeline.find((event) => event.id === 'tl-record');
    if (recordEvent) recordEvent.artifactId = serviceRecord.id;
  }
  if (settlement) {
    const financeEvent = flowBTimeline.find((event) => event.id === 'tl-finance');
    if (financeEvent) financeEvent.artifactId = settlement.id;
  }
}

async function handleAcmeApi(route: Route, url: URL): Promise<boolean> {
  if (url.pathname === '/api/employees') {
    await route.fulfill({ json: { employees: acmeEmployees } });
    return true;
  }
  if (url.pathname === '/api/admin/harness/cases') {
    await route.fulfill({
      json: {
        fixtureDir: 'tests/fixtures/harness',
        cases: [flowACase, flowBCase],
      },
    });
    return true;
  }
  if (url.pathname === '/api/admin/harness/reports/latest') {
    await route.fulfill({ json: { report: harnessReport } });
    return true;
  }
  if (url.pathname === '/api/admin/harness/step-runs') {
    await route.fulfill({ json: { runs: [] } });
    return true;
  }
  if (url.pathname === '/api/admin/harness/run-suite') {
    await route.fulfill({ json: { report: harnessReport } });
    return true;
  }
  if (url.pathname === '/api/runtime/cases') {
    await route.fulfill({ json: { cases: [flowBWorkflowCase] } });
    return true;
  }
  if (url.pathname === `/api/runtime/cases/${flowBWorkflowCase.id}/timeline`) {
    await route.fulfill({ json: { case: flowBWorkflowCase, timeline: flowBTimeline } });
    return true;
  }
  const memoryMatch = url.pathname.match(/^\/api\/admin\/memory\/([^/]+)\/(sources|search|file)$/);
  if (memoryMatch) {
    const employeeId = decodeURIComponent(memoryMatch[1]);
    const action = memoryMatch[2];
    if (action === 'sources') {
      await route.fulfill({ json: { data: memorySources[employeeId] ?? [] } });
      return true;
    }
    if (action === 'search') {
      const query = url.searchParams.get('q') ?? '';
      const file = memoryFiles[employeeId] ?? '';
      const lines = file.split('\n');
      const index = lines.findIndex((line) => line.toLowerCase().includes(query.toLowerCase()));
      await route.fulfill({
        json: {
          data: index >= 0
            ? [{
                file: '2026-06-04.md',
                line: index + 1,
                context: lines.slice(Math.max(0, index - 1), index + 2).join('\n'),
              }]
            : [],
        },
      });
      return true;
    }
    if (action === 'file') {
      await route.fulfill({ json: { data: memoryFiles[employeeId] ?? '' } });
      return true;
    }
  }
  return false;
}

test('captures Acme ultimate acceptance journey', async ({ page }, testInfo) => {
  const realCliReport = runRealCliAcceptance(testInfo.outputPath('real-cli-acceptance.json'));
  expect(realCliReport.status).toBe('passed');
  expect(realCliReport.artifactCounts).toEqual({
    contract_intakes: 1,
    maintenance_schedules: 1,
    service_incidents: 1,
    service_records: 1,
    finance_settlements: 1,
  });
  applyRealCliArtifacts(realCliReport);

  const report = createJourneyReport(testInfo, {
    slug: 'acme-ultimate-acceptance',
    title: 'Acme Ultimate Acceptance Journey',
    note: '展示招标中标到合同入库，以及维保定时任务到维修回执的两条准出流程。',
  });

  await setupProbeConsole(page, handleAcmeApi);

  await page.goto('/harness');
  await expect(page.getByRole('heading', { name: '验收 Harness' })).toBeVisible();
  await expect(page.getByText(flowACase.id).first()).toBeVisible();
  await expect(page.getByText(flowBCase.id).first()).toBeVisible();
  await expect(page.getByText('2 for acme-happycompany')).toBeVisible();
  await report.capture(page, 'harness-two-flows', 'Harness 展示示例医疗两条准出流程');

  await page.getByRole('button', { name: /acme-bid-win-to-contract-intake/ }).click();
  await expect(page.getByText(/med_crm:search_bids/).first()).toBeVisible();
  await expect(page.getByText(/created:maintenance_schedule:schedule-jsrm-540ct-full-service/).first()).toBeVisible();
  await report.capture(page, 'flow-a-contract-schedule-trace', 'Flow A 展示中标、合同入库和维保计划产物');

  await page.getByRole('button', { name: /acme-maintenance-schedule-dispatch-to-receipt/ }).click();
  await expect(page.getByText(/manual:lookup/).first()).toBeVisible();
  await expect(page.getByText(/created:service_record:sr-jsrm-540ct-001/).first()).toBeVisible();
  await report.capture(page, 'flow-b-receipt-trace', 'Flow B 展示说明书查询、维修日志和回执产物');

  await page.goto('/orchestration');
  await expect(page.getByRole('heading', { name: '协同日志' })).toBeVisible();
  await expect(page.getByText(/维保定时任务触发/).first()).toBeVisible();
  await expect(page.getByText('业务产物').first()).toBeVisible();
  await expect(page.getByText(/triggered · maintenance_task · task-jsrm-540ct-2026h2/).first()).toBeVisible();
  await expect(page.getByText(/created · service_record · sr-jsrm-540ct-001/).first()).toBeVisible();
  await expect(page.getByText(/created · finance_settlement · settlement-jsrm-540ct-sr-001/).first()).toBeVisible();
  await report.capture(page, 'orchestration-business-artifacts', 'Orchestration 时间线展示维保触发、回执和财务结算');

  await page.goto('/memory');
  await expect(page.getByRole('heading', { name: 'Memory' })).toBeVisible();
  const memorySubjectSelect = page.getByRole('main').getByRole('combobox');
  await memorySubjectSelect.selectOption(`employee:${tenant}:finance-wangwu`);
  await page.getByPlaceholder('搜索记忆文件...').fill('每半年');
  await page.getByRole('button', { name: '搜索' }).click();
  await page.getByRole('button', { name: '2026-06-04.md' }).click();
  await expect(page.getByText(/维保周期: 每半年一次/).first()).toBeVisible();
  await expect(page.getByText(/付款规则: 每服务满半年并验收合格后付款/).first()).toBeVisible();
  await report.capture(page, 'memory-finance-contract-cycle', 'Memory 展示财务王五沉淀的合同和维保周期');

  await page.getByRole('button', { name: '← 返回列表' }).click();
  await memorySubjectSelect.selectOption(`employee:${tenant}:maintenance-lisi`);
  await page.getByPlaceholder('搜索记忆文件...').fill('SERVICE RECORD');
  await page.getByRole('button', { name: '搜索' }).click();
  await page.getByRole('button', { name: '2026-06-04.md' }).click();
  await expect(page.getByText(/SERVICE RECORD: sr-jsrm-540ct-001/).first()).toBeVisible();
  await expect(page.getByText(/扫描床和高压系统检查正常/).first()).toBeVisible();
  await report.capture(page, 'memory-maintenance-service-record', 'Memory 展示维修李四沉淀的回执和现场结论');

  await report.writeSummary({
    status: 'passed',
    notes: [
      'Flow A 覆盖杭州示例医疗中标、销售交财务、合同 intake 和维保计划 artifact。',
      'Flow B 覆盖 scheduler trigger、财务派单、说明书查询、SERVICE RECORD 回执和财务结算 artifact。',
      'Memory 页面覆盖财务王五的合同维保周期记忆，以及维修李四的 SERVICE RECORD 与现场结论记忆。',
      '本 Journey 开始时会先运行真实 med_crm CLI acceptance runner，确认五类业务 artifact 已写入隔离 SQLite；页面部分使用确定性 E2E mock 展示这些结果。',
    ],
  });
});
