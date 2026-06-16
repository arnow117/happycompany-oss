import { test, expect, type Page } from '@playwright/test';
import { setupToken } from '../helpers';

const caseSummary = {
  id: 'architecture-web-runtime-parity',
  description: 'Web shape should flow through runtime',
  file: 'architecture-web-runtime-parity.yaml',
  input: { channel: 'web', botName: 'sales-zhangsan', tenant: 'acme', userId: 'web-user-001' },
  expect: { routedEmployee: 'sales-zhangsan', noErrors: true },
};

const report = {
  id: 'harness-e2e',
  createdAt: new Date('2026-06-01T08:00:00.000Z').toISOString(),
  summary: { passed: 1, failed: 0, total: 1 },
  text: '1 passed, 0 failed',
  results: [{
    case: {
      ...caseSummary,
      input: { ...caseSummary.input, chatId: 'web-runtime-e2e', text: '查一下浙一医院维保状态' },
    },
    status: 'passed',
    failures: [],
    ingress: {
      reply: 'Web 入口已通过同一运行时查询浙一医院维保状态。',
      trace: {
        input: { channel: 'web', botName: 'sales-zhangsan', chatId: 'web-runtime-e2e' },
        routing: { selectedEmployee: 'sales-zhangsan', mode: 'employee-director' },
        toolCalls: [{ name: 'med_crm:global_search', status: 'complete' }],
        memory: [],
        handoffs: [],
        businessArtifacts: [],
        errors: [],
        startedAt: 1,
        finishedAt: 2,
      },
    },
  }],
};

const stepRun = {
  id: 'step-e2e',
  input: {
    workflowRunId: 'manual-acceptance',
    stepId: 'lookup',
    employeeId: 'sales-zhangsan',
    tenant: 'acme',
    userId: 'web-harness-user',
    chatId: 'step-e2e-chat',
    prompt: '查一下浙一医院维保合同',
  },
  status: 'SUCCEEDED',
  createdAt: 1,
  startedAt: 1,
  finishedAt: 2,
  reply: '已查询到维保合同。',
  attempts: 0,
};

async function mockApi(page: Page) {
  let runs: typeof stepRun[] = [];

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/api/setup/status') {
      await route.fulfill({ json: { configured: true, steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true } } });
      return;
    }
    if (url.pathname === '/api/admin/session') {
      await route.fulfill({ json: { authenticated: true, mode: 'protected' } });
      return;
    }
    if (url.pathname === '/api/tenants') {
      await route.fulfill({ json: { tenants: [{ id: 'acme', displayName: '示例医疗' }] } });
      return;
    }
    if (url.pathname === '/api/workdirs') {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname === '/api/admin/harness/cases') {
      await route.fulfill({ json: { fixtureDir: 'tests/fixtures/harness', cases: [caseSummary] } });
      return;
    }
    if (url.pathname === '/api/admin/harness/reports/latest') {
      await route.fulfill({ json: { report } });
      return;
    }
    if (url.pathname === '/api/admin/harness/run-suite') {
      await route.fulfill({ json: { report } });
      return;
    }
    if (url.pathname === '/api/admin/harness/run-step') {
      runs = [stepRun, ...runs];
      await route.fulfill({ json: { run: stepRun } });
      return;
    }
    if (url.pathname === '/api/admin/harness/step-runs') {
      await route.fulfill({ json: { runs } });
      return;
    }

    await route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await setupToken(page);
  await mockApi(page);
});

test('harness page runs suite and a single workflow step', async ({ page }) => {
  await page.goto('/harness');
  await expect(page.getByRole('heading', { name: '验收 Harness' })).toBeVisible();
  await expect(page.getByText('architecture-web-runtime-parity').first()).toBeVisible();

  await page.getByRole('button', { name: '运行当前企业' }).click();
  await expect(page.getByText(/运行完成：1 passed, 0 failed/)).toBeVisible();

  await expect(page.getByLabel('员工 ID')).toHaveValue('sales-zhangsan');
  await page.getByRole('button', { name: '运行 Step' }).click();
  await expect(page.getByText('StepRun SUCCEEDED: manual-acceptance / lookup')).toBeVisible();
  await expect(page.getByText('manual-acceptance / lookup', { exact: true })).toBeVisible();
});
