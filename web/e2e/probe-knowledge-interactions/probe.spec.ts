import { test, expect, type Route } from '@playwright/test';
import { setupProbeConsole } from '../probe-helpers';

const knowledgeFiles = [
  { name: 'customer-playbook.md', size: 4096 },
  { name: 'pricing-notes.md', size: 1024 },
];

const knowledgeCards = [
  { name: '产品规格总览', tier: 'company', tierId: 'company', size: 2048, updatedAt: '2026-06-01T08:00:00.000Z' },
  { name: '华东销售流程', tier: 'group', tierId: 'sales-east', size: 1536, updatedAt: '2026-06-02T08:00:00.000Z' },
  { name: '销售私有话术', tier: 'employee', tierId: 'sales-zhangsan', size: 512, updatedAt: '2026-06-03T08:00:00.000Z' },
];

async function mockKnowledgeApi(route: Route, url: URL): Promise<boolean> {
  if (url.pathname === '/api/admin/bots/web-bot/knowledge') {
    await route.fulfill({
      json: {
        files: knowledgeFiles,
        path: '/corp/acme-happycompany/agents/web-bot/knowledge',
      },
    });
    return true;
  }

  if (url.pathname === '/api/admin/knowledge') {
    await route.fulfill({ json: { cards: knowledgeCards, tiers: ['company', 'group', 'employee'] } });
    return true;
  }

  if (url.pathname === '/api/admin/bots/web-bot/knowledge/customer-playbook.md' && route.request().method() === 'DELETE') {
    await route.fulfill({ json: { deleted: true } });
    return true;
  }

  return false;
}

test.describe('Probe: knowledge base interactions', () => {
  test('filters tiers and exercises delete dialog cancel/confirm states', async ({ page }) => {
    await setupProbeConsole(page, mockKnowledgeApi);

    await page.goto('/knowledge');
    await expect(page.getByRole('heading', { name: 'Knowledge Base' })).toBeVisible();
    await expect(page.getByText('customer-playbook.md')).toBeVisible();
    await expect(page.getByText('产品规格总览')).toBeVisible();
    await expect(page.getByText('华东销售流程')).toBeVisible();
    await expect(page.getByText('销售私有话术')).toBeVisible();

    await page.getByRole('button', { name: '企业' }).click();
    await expect(page.getByText('产品规格总览')).toBeVisible();
    await expect(page.getByText('华东销售流程')).toHaveCount(0);
    await expect(page.getByText('销售私有话术')).toHaveCount(0);

    await page.getByRole('button', { name: '全部' }).click();
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Delete Knowledge File' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Delete Knowledge File' })).toHaveCount(0);
    await expect(page.getByText('customer-playbook.md')).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).first().click();
    await page.getByRole('dialog', { name: 'Delete Knowledge File' }).getByRole('button', { name: 'Cancel' }).click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Delete Knowledge File' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Delete' }).first().click();
    await page.getByRole('dialog', { name: 'Delete Knowledge File' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Deleted')).toBeVisible();
  });
});
