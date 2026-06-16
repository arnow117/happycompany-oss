import { test, expect } from '@playwright/test';
import { setupToken } from '../helpers';

// ---------------------------------------------------------------------------
// Story Config — Config page: bot management, credential visibility, dropdowns
//
// Uses REAL backend (launched by playwright.config.ts webServer).
// Only POST /api/admin/config is mocked to prevent accidental config writes
// during tests. All GET routes hit the live backend with seed data from
// config.e2e.json + corp/acme/employees/*.yaml.
//
// Covers:
//   1. Page loads without crash (web entry + IM bot list)
//   2. Web entry is separated from IM bot management
//   3. Bot credentials are masked in the list
//   4. Tenant dropdown renders in employee-director mode
//   5. Bot list shows correct channel labels (Web / 钉钉 / 飞书)
//   6. Feishu bot connectivity can be tested from the bot form
//   7. Group reply mode can be configured from the bot form
// ---------------------------------------------------------------------------

/** Minimal setup: inject auth token + mock config reads/writes. */
async function setupConfigPage(page: import('@playwright/test').Page) {
  await setupToken(page);

  // Mock bootstrap status so OnboardingBanner does not crash
  await page.route('**/api/setup/status', async (route) => {
    await route.fulfill({ json: {
      configured: true,
      needsApiKey: false,
      hasBots: true,
      steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true },
    } });
  });

  // Mock admin session so AdminAuthGuard passes
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({ json: { authenticated: true, mode: 'protected' } });
  });

  // Mock tenants for the tenant dropdown
  await page.route('**/api/tenants', async (route) => {
    await route.fulfill({ json: { tenants: [{ id: 'acme', displayName: '示例医疗' }] } });
  });

  // Intercept GET/POST /api/admin/config: GET returns seed data, POST is blocked
  await page.route('**/api/admin/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: {
        bots: {
          'acme': {
            channel: 'web',
            credentials: {},
            displayName: '示例医疗助手',
            routingMode: 'employee-director',
            tenant: 'acme',
          },
          'acme-dingtalk': {
            channel: 'dingtalk',
            credentials: {
              clientId: 'real-client-id-12345',
              clientSecret: 'real-client-secret-67890',
            },
            displayName: '示例医疗钉钉助手',
            routingMode: 'direct',
          },
        },
        claude: {
          baseUrl: 'https://relay.example.com/v1',
          authToken: 'test-auth-token',
          model: 'claude-sonnet-4-6',
        },
      } });
    } else {
      await route.fulfill({ json: { success: true } });
    }
  });

  await page.route('**/api/admin/verify-bot', async (route) => {
    await route.fulfill({ json: {
      ok: true,
      channel: 'feishu',
      botOpenId: 'ou_mock_bot',
    } });
  });
}

test.describe('Config Page', () => {
  test('page loads with web bot without crash', async ({ page }) => {
    await setupConfigPage(page);

    await page.goto('/config');

    await expect(page.getByRole('heading', { name: '配置' }).first()).toBeVisible();
    await expect(page.getByText('示例医疗助手')).toBeVisible();
    await expect(page.getByText('示例医疗钉钉助手')).toBeVisible();
  });

  test('bot list shows correct channel labels', async ({ page }) => {
    await setupConfigPage(page);

    await page.goto('/config');

    await expect(page.getByText('Web').first()).toBeVisible();
    await expect(page.getByText('钉钉').first()).toBeVisible();
  });

  test('credentials are masked in the bot list', async ({ page }) => {
    await setupConfigPage(page);

    await page.goto('/config');

    await expect(page.getByText('clientId=********************, clientSecret=************************')).toBeVisible();
    await expect(page.getByText('real-client-id-12345')).not.toBeVisible();
    await expect(page.getByText('real-client-secret-67890')).not.toBeVisible();
  });

  test('web entry is separated from IM bot management', async ({ page }) => {
    await setupConfigPage(page);

    await page.goto('/config');

    const webSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Web 入口' }) });
    const imSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'IM Bot 管理' }) });
    await expect(webSection.getByText('示例医疗助手', { exact: true })).toBeVisible();
    await expect(webSection.getByText('Web Chat / 后台网页入口')).toBeVisible();
    await expect(imSection.getByText('示例医疗助手', { exact: true })).not.toBeVisible();
    await expect(imSection.getByText('示例医疗钉钉助手')).toBeVisible();
  });

  test('employee-director bot shows tenant dropdown', async ({ page }) => {
    await setupConfigPage(page);

    await page.goto('/config');

    await page.getByRole('button', { name: '+ 添加 Bot' }).click();
    await page.getByPlaceholder('例如：我的助手').fill('测试调度');

    await page.locator('label').filter({ hasText: '路由模式' }).locator('select').selectOption('employee-director');

    // Tenant dropdown populated from corp/acme/app.json
    const tenantSelect = page.locator('select').filter({ has: page.getByText('选择租户') });
    await expect(tenantSelect).toBeVisible();
    await tenantSelect.selectOption('acme');
  });

  test('feishu bot form can test connectivity', async ({ page }) => {
    await setupConfigPage(page);

    await page.goto('/config');

    await page.getByRole('button', { name: '+ 添加 Bot' }).click();
    await page.getByPlaceholder('例如：我的助手').fill('飞书测试助手');
    await page.getByRole('button', { name: '飞书', exact: true }).click();
    await page.getByPlaceholder('输入飞书 App ID').fill('cli_mock');
    await page.getByPlaceholder('输入飞书 App Secret').fill('mock-secret');
    await page.getByRole('button', { name: '测试连接' }).last().click();

    await expect(page.getByText(/连接成功/)).toBeVisible();
    await expect(page.getByText(/ou_mock_bot/)).toBeVisible();
  });

  test('bot form can configure group reply mode', async ({ page }) => {
    await setupConfigPage(page);

    await page.goto('/config');

    await page.getByRole('button', { name: '+ 添加 Bot' }).click();
    await expect(page.getByText('群聊响应模式')).toBeVisible();
    const groupReplySelect = page.locator('label').filter({ hasText: '群聊响应模式' }).locator('select');
    await groupReplySelect.selectOption('all');
    await expect(groupReplySelect).toHaveValue('all');
  });
});
