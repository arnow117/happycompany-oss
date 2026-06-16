import { test, expect, type Route } from '@playwright/test';
import { setupProbeConsole } from '../probe-helpers';

const originalMemory = [
  '# 客户记忆',
  '- 华东客户偏好先看价格和交期。',
].join('\n');

let savedContent = '';

function memorySourcesFor(subject: string) {
  if (subject === 'sales-zhangsan') {
    return [
      { file: 'notes/customer.md', type: 'markdown', size: 128 },
      { file: 'notes/contracts.md', type: 'markdown', size: 96 },
    ];
  }
  return [
    { file: 'sessions/web-bot.json', type: 'json', size: 64 },
  ];
}

async function mockMemoryApi(route: Route, url: URL): Promise<boolean> {
  const sourceMatch = url.pathname.match(/^\/api\/admin\/memory\/([^/]+)\/sources$/);
  if (sourceMatch) {
    await route.fulfill({ json: { data: memorySourcesFor(decodeURIComponent(sourceMatch[1])) } });
    return true;
  }

  const searchMatch = url.pathname.match(/^\/api\/admin\/memory\/([^/]+)\/search$/);
  if (searchMatch) {
    await route.fulfill({
      json: {
        data: [
          { file: 'notes/contracts.md', line: 3, context: '合同审批需要销售和财务一起确认。' },
        ],
      },
    });
    return true;
  }

  const fileMatch = url.pathname.match(/^\/api\/admin\/memory\/([^/]+)\/file$/);
  if (fileMatch && route.request().method() === 'GET') {
    await route.fulfill({ json: { data: originalMemory } });
    return true;
  }

  if (fileMatch && route.request().method() === 'PUT') {
    const body = route.request().postDataJSON() as { path?: string; content?: string };
    savedContent = body.content ?? '';
    await route.fulfill({ json: { success: true } });
    return true;
  }

  return false;
}

test.describe('Probe: memory editor interactions', () => {
  test.beforeEach(() => {
    savedContent = '';
  });

  test('searches, clears, opens, cancels, saves, and returns to memory sources', async ({ page }) => {
    await setupProbeConsole(page, mockMemoryApi);

    await page.goto('/memory');
    await expect(page.getByRole('heading', { name: 'Memory' })).toBeVisible();

    await page.locator('main select').first().selectOption('employee::sales-zhangsan');
    await expect(page.getByRole('button', { name: /notes\/customer\.md/ })).toBeVisible();

    await page.getByPlaceholder('搜索记忆文件...').fill('合同');
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.getByRole('button', { name: /notes\/contracts\.md/ })).toBeVisible();

    await page.getByRole('button', { name: '清除' }).click();
    await expect(page.getByRole('button', { name: /notes\/customer\.md/ })).toBeVisible();

    await page.getByRole('button', { name: /notes\/customer\.md/ }).click();
    await expect(page.locator('textarea')).toHaveValue(originalMemory);

    await page.getByRole('button', { name: '编辑' }).click();
    await page.locator('textarea').fill('临时修改');
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.locator('textarea')).toHaveValue(originalMemory);

    const updatedMemory = `${originalMemory}\n- 下次跟进要带上试用方案。`;
    await page.getByRole('button', { name: '编辑' }).click();
    await page.locator('textarea').fill(updatedMemory);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    expect(savedContent).toBe(updatedMemory);

    await page.getByRole('button', { name: '← 返回列表' }).click();
    await expect(page.getByRole('button', { name: /notes\/customer\.md/ })).toBeVisible();
  });
});
