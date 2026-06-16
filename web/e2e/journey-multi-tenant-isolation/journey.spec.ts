import { test, expect } from '@playwright/test';
import { createJourneyReport } from '../reporting';
import {
  probeAltTenant,
  probeHandoffSession,
  probeRuntimeCases,
  probeTenant,
  setupProbeConsole,
} from '../probe-helpers';

test('captures multi-tenant isolation journey', async ({ page }, testInfo) => {
  const report = createJourneyReport(testInfo, {
    slug: 'multi-tenant-isolation',
    title: 'Multi Tenant Isolation Journey',
    note: '切换企业后，验证运行会话和协同日志不会串到另一个租户。',
  });

  await setupProbeConsole(page);

  await page.goto('/sessions');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByLabel('切换企业')).toHaveValue(probeTenant.id);
  await expect(page.getByText(probeHandoffSession.chatId)).toBeVisible();
  await report.capture(page, 'primary-tenant-sessions', '主企业可见运行会话');

  await page.locator('main select').first().selectOption(probeAltTenant.id);
  await expect(page.getByText('No sessions found.')).toBeVisible();
  await expect(page.getByText(probeHandoffSession.chatId)).toHaveCount(0);
  await report.capture(page, 'alt-tenant-empty-sessions', '切到另一个企业后 Sessions 隔离');

  await page.getByLabel('切换企业').selectOption(probeAltTenant.id);
  await page.goto('/orchestration');
  await expect(page.getByRole('heading', { name: '协同日志' })).toBeVisible();
  await expect(page.getByText('暂无协同记录')).toBeVisible();
  await expect(page.getByText(probeRuntimeCases[0].preview)).toHaveCount(0);
  await report.capture(page, 'alt-tenant-empty-orchestration', '另一个企业没有协同日志串入');

  await page.getByLabel('切换企业').selectOption(probeTenant.id);
  await expect(page.getByText(probeTenant.id)).toBeVisible();
  await expect(page.getByText(probeRuntimeCases[0].preview).first()).toBeVisible();
  await report.capture(page, 'primary-tenant-restored', '切回主企业后恢复原数据');

  await report.writeSummary({
    status: 'passed',
    notes: [
      '验证租户切换后 Sessions 和 Orchestration 均按当前企业读取数据。',
      '本 Journey 覆盖运行态隔离的用户可见表现，底层 worktree/runtime profile 隔离仍由后端与运维规范保障。',
    ],
  });
});
