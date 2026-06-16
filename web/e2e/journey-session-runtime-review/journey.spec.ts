import { test, expect } from '@playwright/test';
import { createJourneyReport } from '../reporting';
import {
  probeHandoffEmployee,
  probeHandoffSession,
  probePerson,
  probeRuntimeSession,
  probeTenant,
  setupProbeConsole,
} from '../probe-helpers';

test('captures session runtime review journey', async ({ page }, testInfo) => {
  const report = createJourneyReport(testInfo, {
    slug: 'session-runtime-review',
    title: 'Session Runtime Review Journey',
    note: '从 Sessions 筛选、展开消息、回到 Chat 上下文，验证运行会话可复盘。',
  });

  await setupProbeConsole(page);

  await page.goto('/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByText(probeHandoffSession.chatId)).toBeVisible();
  await expect(page.getByText(probeRuntimeSession.chatId)).toBeVisible();
  await report.capture(page, 'session-list', 'Sessions 展示运行会话列表');

  await page.locator('main select').nth(1).selectOption('web-bot');
  await page.locator('main select').nth(2).selectOption(probePerson.userId);
  await expect(page.getByText(probeHandoffSession.chatId)).toBeVisible();
  await report.capture(page, 'session-filtered', '按入口和发起人筛选会话');

  await page.getByText(probeHandoffSession.chatId).click();
  await expect(page.getByText('客户问 CT 设备维保状态，需要销售转维修核验')).toBeVisible();
  await expect(page.getByText('维修李四确认：GE16排 CT 维保有效期到 2026-12-31。')).toBeVisible();
  await report.capture(page, 'session-expanded', '展开会话查看消息详情');

  await page.locator('tbody tr').filter({ hasText: probeHandoffSession.chatId }).getByRole('link', { name: 'Chat' }).click();
  await expect(page).toHaveURL(new RegExp(`/chat\\?.*session=${probeHandoffSession.id}`));
  await expect(page.getByText(`将发送给 ${probeHandoffEmployee.displayName}`)).toBeVisible();
  await report.capture(page, 'session-to-chat', '从 Sessions 回到 Chat 运行上下文');

  await report.writeSummary({
    status: 'passed',
    notes: [
      '验证 Sessions 能按入口/人员筛选、展开历史消息，并跳回同一运行上下文。',
      '本 Journey 补齐事后复盘视角，不替代 Chat 协同过程 Journey。',
    ],
  });
});
