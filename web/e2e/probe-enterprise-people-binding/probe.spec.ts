import { test, expect, type Route } from '@playwright/test';
import {
  probeEmployee,
  probePerson,
  probeTenant,
  setupProbeConsole,
} from '../probe-helpers';

let currentPerson = { ...probePerson, role: undefined as string | undefined, entryEmployee: undefined as string | undefined };

async function mockPeopleBindingApi(route: Route, url: URL): Promise<boolean> {
  if (url.pathname === '/api/enterprise-people') {
    await route.fulfill({ json: { people: [currentPerson] } });
    return true;
  }

  if (url.pathname === '/api/enterprise-people/sync') {
    currentPerson = { ...currentPerson, status: 'active' };
    await route.fulfill({
      json: {
        people: [currentPerson],
        sync: { created: 0, updated: 1, inactive: 0, total: 1 },
      },
    });
    return true;
  }

  if (url.pathname.startsWith('/api/enterprise-people/') && url.pathname.endsWith('/bind')) {
    const body = route.request().postDataJSON() as { role?: string | null; entryEmployee?: string };
    currentPerson = {
      ...currentPerson,
      role: body.role ?? currentPerson.role,
      entryEmployee: body.entryEmployee || currentPerson.entryEmployee,
      assistantId: body.entryEmployee || currentPerson.assistantId,
    };
    await route.fulfill({ json: { person: currentPerson } });
    return true;
  }

  return false;
}

test.describe('Probe: enterprise people binding', () => {
  test.beforeEach(() => {
    currentPerson = { ...probePerson, role: undefined, entryEmployee: undefined, assistantId: undefined };
  });

  test('syncs people, assigns role, and binds a personal assistant', async ({ page }) => {
    await setupProbeConsole(page, mockPeopleBindingApi);

    await page.goto('/people');
    await expect(page.getByRole('heading', { name: '企业员工' })).toBeVisible();
    await expect(page.getByText('销售主管')).toBeVisible();
    await expect(page.getByText('未绑定')).toBeVisible();

    await page.getByRole('button', { name: /同步钉钉/ }).click();
    await expect(page.getByText('新增 0，更新 1，停用 0，共 1')).toBeVisible();

    await page.getByLabel('设置 销售主管 的角色').selectOption('sales');
    await expect(page.getByLabel('设置 销售主管 的角色')).toHaveValue('sales');

    await page.getByLabel('绑定 销售主管 的个人助手').selectOption(probeEmployee.id);
    await expect(page.getByLabel('绑定 销售主管 的个人助手')).toHaveValue(probeEmployee.id);
    await expect(page.getByLabel('企业租户')).toHaveValue(probeTenant.id);
  });
});
