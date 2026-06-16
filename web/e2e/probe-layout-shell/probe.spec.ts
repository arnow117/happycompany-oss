import { test, expect } from '@playwright/test';
import { probeAltTenant, setupProbeConsole } from '../probe-helpers';

test.describe('Probe: layout shell interactions', () => {
  test('collapses sidebar, switches tenant, toggles theme, and logs out', async ({ page }) => {
    await setupProbeConsole(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByLabel('后端可用')).toBeVisible();

    await page.getByLabel('收起侧边栏').click();
    await expect(page.getByLabel('展开侧边栏')).toBeVisible();
    await expect(page.getByText('当前企业')).toHaveCount(0);

    await page.getByLabel('展开侧边栏').click();
    await page.getByLabel('切换企业').selectOption(probeAltTenant.id);
    await expect(page.getByText(probeAltTenant.id)).toBeVisible();

    const beforeTheme = await page.locator('html').getAttribute('data-theme');
    await page.getByLabel('Toggle theme').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', beforeTheme ?? '');

    await page.getByLabel('Logout').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
  });

  test('opens and closes mobile navigation without losing the current page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await setupProbeConsole(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    await expect(page.getByRole('link', { name: /知识库/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('link', { name: /知识库/ })).toBeVisible();

    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: /知识库/ })).toHaveCount(0);
  });
});
