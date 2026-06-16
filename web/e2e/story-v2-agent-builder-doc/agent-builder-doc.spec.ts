import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { setupToken } from '../helpers';

const outDir = path.resolve(import.meta.dirname, '../../../docs/reports/agent-builder-iteration-assets');

const employee = {
  id: 'maintenance-qa',
  displayName: '售后质检员工',
  description: '检查维修工单质量，发现赔付或开票问题时转交财务。',
  model: 'claude-sonnet-4-6',
  systemPrompt: '你是医疗器械企业的售后质检数字员工。\n负责检查维修工单质量，发现赔付或开票问题时转交财务。',
  tools: ['med_crm:list_maintenance', 'med_crm:hospital_info'],
  skills: ['med_crm'],
  role: 'maintenance',
  capabilities: ['质检', '维修工单', '售后'],
  workspace: 'agents/maintenance-qa',
  source: 'generated',
  createdAt: Date.now(),
  hasFallbackLevel1: false,
  hasFallbackLevel2: false,
  toolCount: 2,
  skillCount: 1,
  allowedTargets: ['finance-wangwu'],
};

async function mockApi(page: Page) {
  let draft = {
    id: 'natural-language-maintenance-qa',
    tenant: 'acme',
    source: 'natural_language',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input: { naturalLanguage: '创建一个售后质检员工，检查维修工单质量，赔付问题转财务' },
    employee,
    validation: { ok: false, issues: [] },
  };

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

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
    if (url.pathname === '/api/runtime/entries') {
      await route.fulfill({
        json: {
          entries: [{ id: 'web-bot', tenant: 'acme', channel: 'web', displayName: 'Web Entry', routingMode: 'employee-director', enabled: true }],
        },
      });
      return;
    }
    if (url.pathname === '/api/templates') {
      await route.fulfill({ json: { templates: [{ id: 'med-device', name: '医疗器械', description: '医疗设备服务模板', employeeCount: 3 }] } });
      return;
    }
    if (url.pathname === '/api/employees') {
      await route.fulfill({
        json: {
          employees: [
            employee,
            { ...employee, id: 'finance-wangwu', displayName: '财务王五', role: 'finance', workspace: 'agents/finance-wangwu' },
          ],
        },
      });
      return;
    }
    if (url.pathname === '/api/agent-builder/options') {
      await route.fulfill({
        json: {
          tenant: 'acme',
          skills: [{ name: 'med_crm', displayName: '医疗 CRM', description: '医院、合同、维保工具包', toolCount: 3 }],
          tools: [
            { name: 'med_crm:list_maintenance', appName: 'med_crm', description: '查询维保合同', riskLevel: 'read' },
            { name: 'med_crm:hospital_info', appName: 'med_crm', description: '读取医院详情', riskLevel: 'read' },
            { name: 'med_crm:add_incident', appName: 'med_crm', description: '新增维修工单', riskLevel: 'internal_write' },
          ],
          employees: [
            { id: 'finance-wangwu', displayName: '财务王五', role: 'finance', workspace: 'agents/finance-wangwu' },
            { id: 'maintenance-lisi', displayName: '维修李四', role: 'maintenance', workspace: 'agents/maintenance-lisi' },
          ],
        },
      });
      return;
    }
    if (url.pathname === '/api/agent-builder/drafts' && method === 'GET') {
      await route.fulfill({ json: { drafts: [] } });
      return;
    }
    if (url.pathname === '/api/agent-builder/drafts' && method === 'POST') {
      await route.fulfill({ status: 201, json: { draft } });
      return;
    }
    if (url.pathname.endsWith('/validate')) {
      draft = {
        ...draft,
        status: 'validated',
        validation: {
          ok: true,
          issues: [{ severity: 'warning', field: 'employee.tools', message: 'med_crm:add_incident 是写入类工具，发布前需要确认风险' }],
        },
      };
      await route.fulfill({ json: { draft, validation: draft.validation } });
      return;
    }
    if (url.pathname.endsWith('/test')) {
      draft = {
        ...draft,
        status: 'tested',
        harness: {
          yaml: [
            'id: agent-builder-maintenance-qa',
            'expect:',
            '  routedEmployee: maintenance-qa',
            '  toolNamesIncludes:',
            '    - med_crm:list_maintenance',
            '  noErrors: true',
          ].join('\n'),
          lastResult: 'passed',
          failures: [],
        },
      };
      await route.fulfill({ json: { draft, result: { status: 'passed', failures: [] } } });
      return;
    }
    if (url.pathname.endsWith('/sandbox/messages')) {
      draft = {
        ...draft,
        sandbox: {
          lastSessionId: 'acme:builder_sandbox:natural-language-maintenance-qa:builder-tester:default',
          lastResult: 'passed',
          reply: '沙盒回复：维修工单质量检查逻辑正常，赔付问题会转交财务。',
          fingerprint: 'doc-sandbox-fingerprint',
        },
      };
      await route.fulfill({
        json: {
          draft,
          reply: draft.sandbox.reply,
          session: {
            id: draft.sandbox.lastSessionId,
            workdir: '/repo/data/agent-builder/sandbox/acme/natural-language-maintenance-qa/builder-tester',
          },
          trace: { status: 'passed' },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/publish')) {
      draft = { ...draft, status: 'published' };
      await route.fulfill({
        json: {
          draft,
          yamlPath: '/repo/corp/acme/employees/maintenance-qa.yaml',
          workspacePath: '/repo/corp/acme/agents/maintenance-qa',
          colonyRegistered: true,
        },
      });
      return;
    }
    if (url.pathname.includes('/agent-builder/drafts/') && method === 'PUT') {
      draft = route.request().postDataJSON();
      await route.fulfill({ json: { draft } });
      return;
    }

    await route.fulfill({ json: {} });
  });
}

test('capture agent builder iteration screenshots', async ({ page }) => {
  mkdirSync(outDir, { recursive: true });
  await setupToken(page);
  await mockApi(page);

  await page.goto('/agent-builder');
  await expect(page.getByRole('heading', { name: '数字员工 Builder' })).toBeVisible();
  await page.screenshot({ path: path.join(outDir, '01-empty-builder.png'), fullPage: true });

  await page.getByRole('button', { name: '生成草稿' }).click();
  await expect(page.locator('input[value="售后质检员工"]')).toBeVisible();
  await page.screenshot({ path: path.join(outDir, '02-draft-structured-editor.png'), fullPage: true });

  await page.getByRole('button', { name: '校验' }).click();
  await expect(page.getByText('校验完成')).toBeVisible();
  await page.screenshot({ path: path.join(outDir, '03-validation-review.png'), fullPage: true });

  await page.getByRole('button', { name: '测试' }).click();
  await expect(page.getByText('Harness passed')).toBeVisible();
  await page.screenshot({ path: path.join(outDir, '04-harness-passed.png'), fullPage: true });

  await page.getByRole('button', { name: '沙盒试聊' }).click();
  await expect(page.getByText('沙盒试聊已写入 Runtime Session')).toBeVisible();
  await expect(page.getByText('沙盒回复：维修工单质量检查逻辑正常，赔付问题会转交财务。')).toBeVisible();
  await page.screenshot({ path: path.join(outDir, '05-runtime-sandbox-passed.png'), fullPage: true });

  await page.getByRole('button', { name: '发布' }).click();
  await expect(page.getByRole('dialog', { name: '发布确认' })).toBeVisible();
  await page.screenshot({ path: path.join(outDir, '06-publish-confirm.png'), fullPage: true });

  await page.getByRole('button', { name: '确认发布（含风险提示）' }).click();
  await expect(page.getByText('发布成功：maintenance-qa')).toBeVisible();
  await page.screenshot({ path: path.join(outDir, '07-published-success.png'), fullPage: true });
});
