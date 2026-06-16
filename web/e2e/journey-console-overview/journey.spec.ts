import { test, expect, type Page } from '@playwright/test';
import { setupToken, mockWebSocket } from '../helpers';
import { createJourneyReport } from '../reporting';

const employee = {
  id: 'sales-zhangsan',
  displayName: '销售张三',
  description: '负责客户跟进、招投标线索和合同推进。',
  model: 'claude-sonnet-4-6',
  systemPrompt: '你是销售数字员工。',
  tools: ['med_crm:global_search'],
  skills: ['med_crm'],
  role: 'sales',
  capabilities: ['客户跟进', '招投标线索'],
  workspace: 'agents/sales-zhangsan',
  source: 'generated',
  createdAt: Date.now(),
  hasFallbackLevel1: true,
  hasFallbackLevel2: false,
  toolCount: 1,
  skillCount: 1,
};

async function mockConsoleJourneyApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/api/setup/status') {
      await route.fulfill({
        json: {
          configured: true,
          steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true },
        },
      });
      return;
    }
    if (url.pathname === '/api/admin/session') {
      await route.fulfill({ json: { authenticated: true, mode: 'protected' } });
      return;
    }
    if (url.pathname === '/api/health') {
      await route.fulfill({
        json: {
          status: 'ok',
          bots: [
            {
              name: 'web-bot',
              displayName: 'Web 入口',
              status: 'running',
              channel: 'web',
              tenant: 'acme-happycompany',
              routingMode: 'employee-director',
            },
          ],
        },
      });
      return;
    }
    if (url.pathname === '/api/chats') {
      await route.fulfill({
        json: [
          { botName: 'web-bot', chatId: 'demo-chat-1', messageCount: 8, lastMessageAt: Date.now() },
          { botName: 'web-bot', chatId: 'demo-chat-2', messageCount: 3, lastMessageAt: Date.now() - 60000 },
        ],
      });
      return;
    }
    if (url.pathname === '/api/tenants') {
      await route.fulfill({ json: { tenants: [{ id: 'acme-happycompany', displayName: '示例医疗 HappyCompany' }] } });
      return;
    }
    if (url.pathname === '/api/workdirs') {
      await route.fulfill({
        json: [
          {
            id: 'acme-happycompany',
            displayName: '示例医疗 HappyCompany',
            path: '/corp/acme-happycompany',
            channels: ['web'],
            status: 'running',
            tenant: 'acme-happycompany',
          },
        ],
      });
      return;
    }
    if (url.pathname === '/api/runtime/entries') {
      await route.fulfill({
        json: {
          entries: [
            {
              id: 'web-bot',
              tenant: 'acme-happycompany',
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
    if (url.pathname === '/api/templates') {
      await route.fulfill({ json: { templates: [{ id: 'med-device', name: '医疗器械', description: '医疗器械模板', employeeCount: 3 }] } });
      return;
    }
    if (url.pathname === '/api/employees') {
      await route.fulfill({ json: { employees: [employee] } });
      return;
    }
    if (url.pathname === '/api/enterprise-people') {
      await route.fulfill({
        json: {
          people: [
            {
              userId: 'sales-user-001',
              name: '销售主管',
              departments: [{ id: 'sales', name: '销售部' }],
              status: 'active',
              source: 'dingtalk',
              syncedAt: Date.now(),
              updatedAt: Date.now(),
              entryEmployee: 'sales-zhangsan',
              routingMode: 'selector',
              visibleEmployees: ['sales-zhangsan'],
            },
          ],
        },
      });
      return;
    }
    if (url.pathname === '/api/agent-builder/drafts') {
      await route.fulfill({ json: { drafts: [] } });
      return;
    }
    if (url.pathname === '/api/agent-builder/options') {
      await route.fulfill({
        json: {
          tenant: 'acme-happycompany',
          skills: [{ name: 'med_crm', displayName: '医疗 CRM', description: '客户与合同工具包', toolCount: 1 }],
          tools: [{ name: 'med_crm:global_search', appName: 'med_crm', description: '全局搜索', riskLevel: 'read' }],
          employees: [employee],
        },
      });
      return;
    }

    await route.fulfill({ json: {} });
  });
}

test('captures console overview journey', async ({ page }, testInfo) => {
  const report = createJourneyReport(testInfo, {
    slug: 'console-overview',
    title: 'Console Overview Journey',
    note: '控制台从运行概览进入员工构建，再查看已发布数字员工目录。',
  });

  await setupToken(page);
  await mockWebSocket(page);
  await mockConsoleJourneyApi(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Entry Status')).toBeVisible();
  await report.capture(page, 'dashboard', 'Dashboard 运行概览');

  await page.goto('/agent-builder');
  await expect(page.getByRole('heading', { name: '数字员工 Builder' })).toBeVisible();
  await expect(page.getByText('对话式组装员工')).toBeVisible();
  await report.capture(page, 'agent-builder', '员工 Builder');

  await page.goto('/employees');
  await expect(page.getByRole('heading', { name: '数字员工', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '销售张三' })).toBeVisible();
  await report.capture(page, 'employees', '数字员工目录');

  await report.writeSummary({
    status: 'passed',
    notes: [
      '验证控制台 Dashboard、员工 Builder 和数字员工目录三个核心入口。',
      '本 journey 使用显式 API mock，适合作为报告模式样例，不进入默认 gate。',
    ],
  });
});
