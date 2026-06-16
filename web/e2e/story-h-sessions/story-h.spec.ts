import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Story H — Sessions page (API mock)
//
// Covers:
//   - Page loads with runtime tenant/entry/actor filters, empty state when no sessions
//   - Session listing with chat IDs and clear buttons
//   - Clear archives a runtime session and removes it from the list
//   - Runtime filters populated from runtime directory endpoints
// ---------------------------------------------------------------------------

const TEST_TENANT = { id: 'tenant-a', displayName: 'Tenant A' };
const TEST_ENTRY = { id: 'web-bot', tenant: 'tenant-a', channel: 'web', displayName: 'Web Entry', routingMode: 'employee-director', enabled: true };
const TEST_ACTOR = { tenant: 'tenant-a', actorId: 'user-sales', source: 'people', displayName: 'Sales User', bindings: [{ employeeId: 'sales-zhangsan', isDefault: true }] };

function mockAuth(page: Page) {
  page.route('**/api/setup/status', async (route) => {
    await route.fulfill({
      json: {
        configured: true,
        steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true },
      },
    });
  });
  page.route('**/api/admin/session', async (route) => {
    await route.fulfill({ json: { authenticated: true, mode: 'development' } });
  });
  page.route('**/api/health', async (route) => {
    await route.fulfill({ json: { status: 'ok', bots: [] } });
  });
  page.route('**/api/tenants', async (route) => {
    await route.fulfill({ json: { tenants: [TEST_TENANT] } });
  });
  page.route('**/api/runtime/entries?*', async (route) => {
    await route.fulfill({ json: { entries: [TEST_ENTRY] } });
  });
  page.route('**/api/runtime/actors?*', async (route) => {
    await route.fulfill({ json: { actors: [TEST_ACTOR] } });
  });
}

test.describe('Story H: Sessions', () => {
  test('empty state when no sessions', async ({ page }) => {
    mockAuth(page);
    page.route('**/api/runtime/sessions?*', async (route) => {
      await route.fulfill({ json: { sessions: [] } });
    });

    await page.goto('/sessions');

    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(page.getByText('Manage Claude sessions and view conversation history.')).toBeVisible();
    await expect(page.getByText('No sessions found.')).toBeVisible();
  });

  test('session listing with chat IDs and clear buttons', async ({ page }) => {
    mockAuth(page);
    page.route('**/api/runtime/sessions?*', async (route) => {
      await route.fulfill({ json: {
        sessions: [
          { id: 'session-1', tenant: 'tenant-a', entryId: 'web-bot', channel: 'web', actorId: 'user-sales', chatId: 'abc-123-def', employeeId: 'sales-zhangsan', instanceId: 'i1', workdir: '/tmp/a', sdkSessionScope: 'scope-1', mode: 'single_employee', messageCount: 1, lastMessageAt: 1000, preview: 'hello' },
          { id: 'session-2', tenant: 'tenant-a', entryId: 'web-bot', channel: 'web', actorId: 'user-sales', chatId: 'xyz-789-uvw', employeeId: 'sales-zhangsan', instanceId: 'i1', workdir: '/tmp/a', sdkSessionScope: 'scope-2', mode: 'single_employee', messageCount: 0, lastMessageAt: 900, preview: '' },
        ],
      } });
    });

    await page.goto('/sessions');

    await expect(page.getByText('abc-123-def')).toBeVisible();
    await expect(page.getByText('xyz-789-uvw')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear' })).toHaveCount(2);
  });

  test('clear session shows feedback', async ({ page }) => {
    mockAuth(page);
    let sessions = [
      { id: 'session-clear', tenant: 'tenant-a', entryId: 'web-bot', channel: 'web', actorId: 'user-sales', chatId: 'session-to-clear', employeeId: 'sales-zhangsan', instanceId: 'i1', workdir: '/tmp/a', sdkSessionScope: 'scope-clear', mode: 'single_employee', messageCount: 1, lastMessageAt: 1000, preview: 'hello' },
    ];

    page.route('**/api/runtime/sessions?*', async (route) => {
      await route.fulfill({ json: { sessions } });
    });
    page.route('**/api/runtime/sessions/session-clear', async (route) => {
      if (route.request().method() === 'DELETE') {
        sessions = [];
        await route.fulfill({ json: { archived: true, session: { id: 'session-clear', archivedAt: 1001 } } });
        return;
      }
      await route.fallback();
    });

    await page.goto('/sessions');
    await expect(page.getByText('session-to-clear')).toBeVisible();

    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(page.getByText('No sessions found.')).toBeVisible();
  });

  test('runtime filters populated from directory endpoints', async ({ page }) => {
    mockAuth(page);
    page.route('**/api/runtime/sessions?*', async (route) => {
      await route.fulfill({ json: { sessions: [] } });
    });

    await page.goto('/sessions');

    await expect(page.getByRole('combobox').nth(0)).toContainText('Tenant A');
    await expect(page.getByRole('combobox').nth(1)).toContainText('Web Entry');
    await expect(page.getByRole('combobox').nth(2)).toContainText('Sales User');
  });
});
