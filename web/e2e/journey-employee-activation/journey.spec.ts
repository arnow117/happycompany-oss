import { test, expect, type Page, type Route } from '@playwright/test';
import { mockWebSocket } from '../helpers';
import { createJourneyReport } from '../reporting';
import {
  probeEmployee,
  probePerson,
  probeRuntimeSession,
  probeTenant,
  setupProbeConsole,
} from '../probe-helpers';

async function mockEmployeeActivationApi(route: Route, url: URL): Promise<boolean> {
  if (url.pathname === '/api/templates') {
    await route.fulfill({
      json: {
        templates: [
          { id: 'med-device', name: '医疗器械', description: '医疗器械模板', employeeCount: 3 },
        ],
      },
    });
    return true;
  }

  if (url.pathname === '/api/agent-builder/drafts') {
    await route.fulfill({
      json: {
        drafts: [
          {
            id: 'draft-sales-activation',
            tenant: probeTenant.id,
            status: 'published',
            employee: {
              ...probeEmployee,
              capabilities: ['客户跟进', '报价方案'],
              hasFallbackLevel1: true,
              hasFallbackLevel2: false,
              toolCount: 1,
              skillCount: 1,
              createdAt: Date.now(),
              systemPrompt: '你是销售数字员工，负责客户跟进和报价方案。',
            },
            validation: {
              status: 'passed',
              errors: [],
              warnings: [],
              summary: '能力边界清晰，可以发布。',
            },
            testResult: {
              status: 'passed',
              failures: [],
            },
            publishedAt: new Date().toISOString(),
          },
        ],
      },
    });
    return true;
  }

  if (url.pathname === '/api/agent-builder/options') {
    await route.fulfill({
      json: {
        tenant: probeTenant.id,
        skills: [{ name: 'med_crm', displayName: '医疗 CRM', description: '客户与合同工具包', toolCount: 1 }],
        tools: [{ name: 'med_crm:global_search', appName: 'med_crm', description: '全局搜索', riskLevel: 'read' }],
        employees: [probeEmployee],
      },
    });
    return true;
  }

  if (url.pathname.endsWith('/capabilities')) {
    await route.fulfill({
      json: {
        capability: {
          tenant: probeTenant.id,
          employeeId: probeEmployee.id,
          displayName: probeEmployee.displayName,
          role: 'sales',
          workspace: {
            relative: `agents/${probeEmployee.id}`,
            absolute: `/corp/${probeTenant.id}/agents/${probeEmployee.id}`,
            hasClaudeMd: true,
          },
          promptSource: {
            yamlSystemPrompt: true,
            workspaceClaudeMd: true,
          },
          capabilities: ['客户跟进', '报价方案'],
          skills: [
            {
              name: 'med_crm',
              displayName: '医疗 CRM',
              description: '客户与合同工具包',
              installed: true,
              toolCount: 1,
              allowed: true,
            },
          ],
          tools: [
            {
              name: 'med_crm:global_search',
              appName: 'med_crm',
              description: '全局搜索',
              riskLevel: 'read',
              registered: true,
              allowed: true,
            },
          ],
          handoffTargets: [],
          mcpBoundary: {
            platformMcpVisible: true,
            businessMcpDirectVisible: false,
            businessInterface: 'run_skill',
          },
          summary: {
            skillCount: 1,
            toolCount: 1,
            allowedToolCount: 1,
            highRiskToolCount: 0,
            handoffTargetCount: 0,
            warningCount: 0,
          },
          warnings: [],
        },
      },
    });
    return true;
  }

  if (url.pathname.startsWith('/api/enterprise-people/') && url.pathname.endsWith('/bind')) {
    await route.fulfill({
      json: {
        person: {
          ...probePerson,
          role: 'sales',
          entryEmployee: probeEmployee.id,
          assistantId: probeEmployee.id,
          routingMode: 'bound',
          visibleEmployees: [],
        },
      },
    });
    return true;
  }

  if (url.pathname === '/api/enterprise-people/sync') {
    await route.fulfill({
      json: {
        people: [probePerson],
        sync: { created: 0, updated: 1, inactive: 0, total: 1 },
      },
    });
    return true;
  }

  return false;
}

async function emitActivationMessages(page: Page): Promise<void> {
  await page.evaluate((payload) => {
    const ws = (window as unknown as { __mockWs?: { receiveMessage: (msg: Record<string, unknown>) => void } }).__mockWs;
    ws?.receiveMessage({
      type: 'new_message',
      chatId: payload.chatId,
      message: {
        id: 'journey-user-live',
        chatId: payload.chatId,
        source: 'user',
        text: '客户跟进需要准备报价方案',
        botName: payload.employeeId,
        timestamp: Date.now(),
        tenant: payload.tenant,
        entryId: payload.entryId,
        actorId: payload.actorId,
      },
      meta: payload,
    });
    ws?.receiveMessage({
      type: 'new_message',
      chatId: payload.chatId,
      message: {
        id: 'journey-bot-live',
        chatId: payload.chatId,
        source: 'bot',
        text: '我会整理客户背景、报价要点和下一步跟进计划。',
        botName: payload.employeeId,
        timestamp: Date.now(),
        tenant: payload.tenant,
        entryId: payload.entryId,
        actorId: payload.actorId,
      },
      meta: payload,
    });
  }, {
    tenant: probeTenant.id,
    entryId: 'web-bot',
    actorId: probePerson.userId,
    employeeId: probeEmployee.id,
    sessionId: probeRuntimeSession.id,
    chatId: probeRuntimeSession.chatId,
  });
}

test('captures employee activation journey', async ({ page }, testInfo) => {
  const report = createJourneyReport(testInfo, {
    slug: 'employee-activation',
    title: 'Employee Activation Journey',
    note: '从员工发布状态、员工目录、企业员工绑定、Chat 使用到 Sessions 运行追踪。',
  });

  await mockWebSocket(page);
  await setupProbeConsole(page, mockEmployeeActivationApi);

  await page.goto('/agent-builder');
  await expect(page.getByRole('heading', { name: '数字员工 Builder' })).toBeVisible();
  await expect(page.getByRole('button', { name: /销售张三/ })).toBeVisible();
  await report.capture(page, 'builder-published', 'Builder 已发布员工');

  await page.goto('/employees');
  await expect(page.getByRole('heading', { name: '数字员工', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '销售张三' })).toBeVisible();
  await report.capture(page, 'employee-directory', '数字员工目录');

  await page.goto('/people');
  await expect(page.getByRole('heading', { name: '企业员工' })).toBeVisible();
  await expect(page.getByText('销售主管')).toBeVisible();
  await expect(page.getByLabel('绑定 销售主管 的个人助手')).toHaveValue(probeEmployee.id);
  await report.capture(page, 'people-binding', '企业员工绑定');

  await page.goto(`/chat?tenant=${probeTenant.id}&entry=web-bot&actor=${probePerson.userId}&employee=${probeEmployee.id}&session=${probeRuntimeSession.id}&chat=${probeRuntimeSession.chatId}`);
  await expect(page.getByText('已连接')).toBeVisible();
  await expect(page.getByText('将发送给 销售张三')).toBeVisible();
  await page.getByPlaceholder('输入业务请求...').fill('客户跟进需要准备报价方案');
  await page.keyboard.press('Enter');
  await emitActivationMessages(page);
  await expect(page.getByText('我会整理客户背景、报价要点和下一步跟进计划。').first()).toBeVisible();
  await report.capture(page, 'chat-activation', 'Chat 使用数字员工');

  await page.goto('/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByText(probeRuntimeSession.chatId)).toBeVisible();
  await page.getByText(probeRuntimeSession.chatId).click();
  await expect(page.getByText('客户跟进需要准备报价方案')).toBeVisible();
  await report.capture(page, 'session-review', 'Sessions 运行追踪');

  await report.writeSummary({
    status: 'passed',
    notes: [
      '验证员工发布状态、目录可见、企业员工绑定、Chat 对话和 Sessions 追踪。',
      '本 Journey 使用显式 API/WebSocket mock，适合作为员工激活报告链路样例。',
    ],
  });
});
