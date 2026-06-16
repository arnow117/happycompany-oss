import { test, expect } from '@playwright/test';
import { setupToken } from '../helpers';

// ---------------------------------------------------------------------------
// Story Bootstrap Flow — Three-step onboarding:
//   1. ModelConfig → configure API key
//   2. Employees / Builder → create digital employees
//   3. People → bind people to entry employees
//
// All API routes are mocked. No live backend dependency.
// ---------------------------------------------------------------------------

async function setupBootstrapMocks(page: import('@playwright/test').Page) {
  await setupToken(page);

  // Mock admin session
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({ json: { authenticated: true, mode: 'protected' } });
  });

  await page.route('**/api/tenants', async (route) => {
    await route.fulfill({ json: { tenants: [{ id: 'acme', displayName: '示例医疗' }] } });
  });
}

test.describe('Bootstrap Flow', () => {
  test('step 1: unconfigured system shows banner pointing to model-config', async ({ page }) => {
    await setupBootstrapMocks(page);

    // Status: nothing configured
    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: false,
        steps: { modelConfigured: false, employeeNetworkReady: false, peopleBound: false },
      } });
    });

    await page.goto('/');

    // Banner should show step 1
    await expect(page.getByText('步骤 1 / 3: 配置模型')).toBeVisible();
    await expect(page.getByRole('button', { name: '继续配置' })).toBeVisible();
  });

  test('step 1: ModelConfig page saves API key', async ({ page }) => {
    await setupBootstrapMocks(page);

    let savedConfig: Record<string, unknown> | null = null;
    await page.route('**/api/admin/config', async (route) => {
      if (route.request().method() === 'POST') {
        savedConfig = route.request().postDataJSON();
        await route.fulfill({ json: { success: true } });
      } else {
        await route.fulfill({ json: {
          claude: {},
          bots: {},
        } });
      }
    });

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: false,
        steps: { modelConfigured: false, employeeNetworkReady: false, peopleBound: false },
      } });
    });

    await page.goto('/model-config');
    await expect(page.getByRole('heading', { name: '模型配置' })).toBeVisible();

    // Switch to official API key mode
    await page.getByRole('button', { name: '官方渠道' }).click();

    // Fill API key
    await page.getByPlaceholder('sk-ant-api03-...').fill('sk-test-123');
    await page.getByRole('button', { name: '保存并继续' }).click();

    // Verify config was saved
    expect(savedConfig).toBeTruthy();
  });

  test('step 2: after model configured, banner points to digital employees', async ({ page }) => {
    await setupBootstrapMocks(page);

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: false,
        steps: { modelConfigured: true, employeeNetworkReady: false, peopleBound: false },
      } });
    });

    await page.goto('/');

    await expect(page.getByText('步骤 2 / 3: 创建数字员工')).toBeVisible();
  });

  test('step 2: legacy employee-network URL redirects to Employees', async ({ page }) => {
    await setupBootstrapMocks(page);

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: false,
        steps: { modelConfigured: true, employeeNetworkReady: false, peopleBound: false },
      } });
    });

    await page.route('**/api/employees**', async (route) => {
      await route.fulfill({ json: { employees: [] } });
    });

    await page.goto('/employee-network');
    await expect(page).toHaveURL('/employees');
  });

  test('step 2: Employees is the canonical employee setup page', async ({ page }) => {
    await setupBootstrapMocks(page);

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: false,
        steps: { modelConfigured: true, employeeNetworkReady: false, peopleBound: false },
      } });
    });

    await page.route('**/api/employees**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/employees/stats') {
        await route.fulfill({ json: { total: 0, active: 0, generated: 0, avgTools: 0, avgSkills: 0 } });
        return;
      }
      if (url.pathname === '/api/employees/templates') {
        await route.fulfill({ json: { templates: [] } });
        return;
      }
      await route.fulfill({ json: { employees: [] } });
    });

    await page.goto('/employees');
    await expect(page.getByRole('heading', { name: '数字员工', exact: true })).toBeVisible();
  });

  test('step 3: after employees are ready, banner points to People', async ({ page }) => {
    await setupBootstrapMocks(page);

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: false,
        steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: false },
      } });
    });

    await page.goto('/');

    await expect(page.getByText('步骤 3 / 3: 绑定人员')).toBeVisible();
  });

  test('step 3: legacy people-binding URL redirects to People', async ({ page }) => {
    await setupBootstrapMocks(page);

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: false,
        steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: false },
      } });
    });

    await page.route('**/api/enterprise-people**', async (route) => {
      await route.fulfill({ json: {
        people: [],
      } });
    });

    await page.route('**/api/employees**', async (route) => {
      await route.fulfill({ json: {
        employees: [
          { id: 'sales-agent', displayName: '销售助手', role: 'sales' },
          { id: 'ops-agent', displayName: '运维助手', role: 'ops' },
        ],
      } });
    });

    await page.goto('/people-binding');
    await expect(page).toHaveURL('/people');
  });

  test('fully configured system hides banner', async ({ page }) => {
    await setupBootstrapMocks(page);

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: true,
        steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true },
      } });
    });

    await page.goto('/');

    // Banner should not be visible
    await expect(page.getByText('步骤 1 / 3')).not.toBeVisible();
    await expect(page.getByText('步骤 2 / 3')).not.toBeVisible();
    await expect(page.getByText('步骤 3 / 3')).not.toBeVisible();
  });

  test('dismiss banner stores in localStorage', async ({ page }) => {
    await setupBootstrapMocks(page);

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({ json: {
        configured: false,
        steps: { modelConfigured: false, employeeNetworkReady: false, peopleBound: false },
      } });
    });

    await page.goto('/');
    await expect(page.getByText('步骤 1 / 3')).toBeVisible();

    // Click dismiss
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // Verify localStorage
    const dismissed = await page.evaluate(() => localStorage.getItem('onboarding-dismissed'));
    expect(dismissed).toBe('true');

    // Banner should be gone
    await expect(page.getByText('步骤 1 / 3')).not.toBeVisible();
  });
});
