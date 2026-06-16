import { test, expect, type Route } from '@playwright/test';
import { setupProbeConsole } from '../probe-helpers';

const baseConfig = {
  claude: {
    baseUrl: 'https://relay.example.com/v1',
    authToken: '********',
    model: 'sonnet',
  },
  webChat: {
    welcomeTitle: '你好，有什么可以帮你？',
    welcomeSubtitle: '选择下方话题快速开始，或直接输入你的问题。',
    inputPlaceholder: '输入业务请求...',
    historyLimit: 50,
    enableImageUpload: false,
    showSessionPicker: true,
    showQuickPrompts: false,
  },
  bots: {
    'web-bot': {
      channel: 'web',
      displayName: 'Web 入口',
      tenant: 'acme-happycompany',
      routingMode: 'employee-director',
    },
    'feishu-sales': {
      channel: 'feishu',
      displayName: '飞书销售助手',
      credentials: { appId: 'cli_xxx', appSecret: '********' },
      groupReplyMode: 'mention-only',
    },
  },
};

let savedPlaceholder = '';

async function mockConfigApi(route: Route, url: URL): Promise<boolean> {
  if (url.pathname === '/api/admin/config' && route.request().method() === 'GET') {
    await route.fulfill({ json: baseConfig });
    return true;
  }

  if (url.pathname === '/api/admin/config/reveal') {
    await route.fulfill({
      json: {
        ...baseConfig,
        claude: { ...baseConfig.claude, authToken: 'relay-token-real' },
      },
    });
    return true;
  }

  if (url.pathname === '/api/admin/config' && route.request().method() === 'POST') {
    const body = route.request().postDataJSON() as { webChat?: { inputPlaceholder?: string } };
    savedPlaceholder = body.webChat?.inputPlaceholder ?? '';
    await route.fulfill({ json: { success: true } });
    return true;
  }

  if (url.pathname === '/api/admin/verify-model') {
    await route.fulfill({ json: { ok: true, model: 'sonnet' } });
    return true;
  }

  if (url.pathname === '/api/admin/verify-bot') {
    await route.fulfill({ json: { ok: true, channel: 'feishu', botOpenId: 'ou_sales' } });
    return true;
  }

  return false;
}

test.describe('Probe: config editing', () => {
  test.beforeEach(() => {
    savedPlaceholder = '';
  });

  test('reveals masked token, tests model connection, and saves Web Chat copy', async ({ page }) => {
    await setupProbeConsole(page, mockConfigApi);

    await page.goto('/config');
    await expect(page.getByRole('heading', { name: '配置', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Web 入口' })).toBeVisible();
    await expect(page.getByText('飞书销售助手')).toBeVisible();

    await page.getByTitle('显示 Token').first().click();
    await expect(page.getByText('relay-token-real')).toBeVisible();

    await page.getByRole('button', { name: '测试连接' }).first().click();
    await expect(page.getByText(/连接成功/)).toBeVisible();

    await page.getByRole('button', { name: '编辑 Web Chat' }).click();
    await page.getByLabel('输入框提示').fill('请输入客户问题或跟进线索...');
    await page.getByRole('button', { name: '保存 Web Chat' }).click();
    await expect(page.getByText('配置保存成功')).toBeVisible();
    expect(savedPlaceholder).toBe('请输入客户问题或跟进线索...');
  });
});
