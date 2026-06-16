import { test, expect } from '@playwright/test';
import { probeHandoffEmployee, probeRuntimeCases, setupProbeConsole } from '../probe-helpers';

test.describe('Probe: orchestration interactions', () => {
  test('filters cases, switches timeline detail, and surfaces empty state', async ({ page }) => {
    await setupProbeConsole(page);

    await page.goto('/orchestration');
    await expect(page.getByRole('heading', { name: '协同日志' })).toBeVisible();
    await expect(page.getByText('2 事项')).toBeVisible();
    await expect(page.getByText('1 handoff').first()).toBeVisible();
    await expect(page.getByText('客户问 CT 设备维保状态，需要销售转维修核验').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /客户跟进需要准备报价方案/ })).toBeVisible();

    await expect(page.getByText('员工协同')).toBeVisible();
    await expect(page.getByText(`${probeRuntimeCases[0].participants.length} employees`)).toBeVisible();
    await expect(page.getByText(probeHandoffEmployee.id).first()).toBeVisible();

    await page.getByPlaceholder('搜索员工、入口或消息').fill('报价');
    await expect(page.getByRole('button', { name: /客户跟进需要准备报价方案/ })).toBeVisible();
    await expect(page.getByText('客户问 CT 设备维保状态，需要销售转维修核验')).toHaveCount(0);
    await expect(page.getByText('1', { exact: true }).first()).toBeVisible();

    await page.getByPlaceholder('搜索员工、入口或消息').fill('不存在的事项');
    await expect(page.getByText('暂无协同记录')).toBeVisible();

    await page.getByPlaceholder('搜索员工、入口或消息').fill('');
    await page.getByRole('button', { name: /客户问 CT 设备维保状态/ }).click();
    await expect(page.getByText('员工协同')).toBeVisible();
    await expect(page.getByText('需要确认设备维保记录')).toBeVisible();
    await expect(page.getByText('工具 maintenance_records:lookup')).toBeVisible();
  });
});
