import { test, expect, type Route } from '@playwright/test';
import { probeTenant, setupProbeConsole } from '../probe-helpers';

const skillPackage = {
  id: 'med_crm',
  name: 'med_crm',
  description: '示例医疗客户、设备、维保合同和销售活动工具包',
  source: `tenant:${probeTenant.id}`,
  enabled: true,
  userInvocable: true,
  allowedTools: [
    'med_crm:search_hospitals',
    'med_crm:global_search',
    'med_crm:hospital_info',
  ],
  argumentHint: null,
  updatedAt: '2026-06-04T00:00:00.000Z',
  files: [
    { name: 'SKILL.md', type: 'file', size: 4096 },
    { name: 'tools.json', type: 'file', size: 8192 },
    { name: 'med_crm/cli.py', type: 'file', size: 2048 },
  ],
};

const globalSkill = {
  id: 'browser',
  name: 'browser',
  description: '浏览器自动化',
  source: 'global',
  enabled: true,
  userInvocable: true,
  allowedTools: [],
  argumentHint: null,
  updatedAt: '2026-06-04T00:00:00.000Z',
  files: [{ name: 'SKILL.md', type: 'file', size: 1000 }],
};

async function handleSkillApi(route: Route, url: URL): Promise<boolean> {
  if (url.pathname === '/api/admin/skills') {
    expect(url.searchParams.get('tenant')).toBe(probeTenant.id);
    await route.fulfill({ json: [skillPackage, globalSkill] });
    return true;
  }

  if (url.pathname === '/api/admin/skills/med_crm/employees') {
    await route.fulfill({
      json: [
        {
          id: 'sales-zhangsan',
          displayName: '销售张三',
          role: 'sales',
          tenant: probeTenant.id,
        },
      ],
    });
    return true;
  }

  if (url.pathname.startsWith('/api/admin/skills/') && url.pathname.endsWith('/employees')) {
    await route.fulfill({ json: [] });
    return true;
  }

  return false;
}

test.describe('Probe: skill marketplace package view', () => {
  test('shows tenant skill package metadata and filters away global skills', async ({ page }) => {
    await setupProbeConsole(page, handleSkillApi);

    await page.goto('/skills-marketplace');
    await expect(page.getByRole('heading', { name: '技能市场' })).toBeVisible();
    await expect(page.getByText('浏览企业技能和全局技能。员工绑定请到数字员工页面管理。')).toBeVisible();

    await expect(page.getByText('企业技能').first()).toBeVisible();
    await expect(page.getByText('全局技能').first()).toBeVisible();
    await expect(page.getByText('med_crm', { exact: true })).toBeVisible();
    await expect(page.getByText('示例医疗客户、设备、维保合同和销售活动工具包')).toBeVisible();
    await expect(page.getByText('企业 · acme-happycompany')).toBeVisible();
    await expect(page.getByText(/med_crm:search_hospitals/)).toBeVisible();
    await expect(page.getByRole('link', { name: /销售张三/ })).toBeVisible();

    await expect(page.getByText('+ New Skill')).toHaveCount(0);
    await expect(page.getByText('+ Publish')).toHaveCount(0);
    await expect(page.getByText('Workdir Skills')).toHaveCount(0);

    await page.getByRole('button', { name: '企业技能' }).click();
    await expect(page.getByText('med_crm', { exact: true })).toBeVisible();
    await expect(page.getByText('browser')).toHaveCount(0);

    await page.getByRole('button', { name: '全局技能' }).click();
    await expect(page.getByText('browser')).toBeVisible();
    await expect(page.getByText('med_crm', { exact: true })).toHaveCount(0);
  });

  test('keeps legacy app query links focused on the matching skill package', async ({ page }) => {
    await setupProbeConsole(page, handleSkillApi);

    await page.goto('/skills-marketplace?app=med_crm');
    await expect(page.getByText('已从链接定位到「med_crm」。员工技能绑定请在数字员工页面调整。')).toBeVisible();
    await expect(page.getByText('med_crm', { exact: true })).toBeVisible();
    await expect(page.getByText('browser')).toHaveCount(0);
  });
});
