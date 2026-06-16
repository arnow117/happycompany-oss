import { type Page, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Navigation & Screenshot helpers
// ---------------------------------------------------------------------------

export async function waitForDashboard(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
}

export function screenshot(storyDir: string) {
  return async (page: Page, step: string) => {
    await page.screenshot({
      path: `e2e/${storyDir}/__screenshots__/${step}.png`,
      fullPage: true,
    });
  };
}

// ---------------------------------------------------------------------------
// Auth & API mock helpers
// ---------------------------------------------------------------------------

export interface BotOption {
  name: string;
  displayName: string;
}

const DEFAULT_BOT: BotOption = { name: 'test-bot', displayName: 'Test Bot' };

/** Mock /api/setup/status + /api/health as a fully configured system. */
export function mockAuth(page: Page, bots: BotOption[] = [DEFAULT_BOT]): void {
  page.route('**/api/setup/status', async (route) => {
    await route.fulfill({ json: {
      configured: true,
      steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true },
    } });
  });
  page.route('**/api/health', async (route) => {
    await route.fulfill({ json: { status: 'ok', bots } });
  });
}

/** Mock /api/setup/status as unconfigured (first-run wizard). */
export function mockUnconfigured(page: Page): void {
  page.route('**/api/setup/status', async (route) => {
    await route.fulfill({ json: {
      configured: false,
      steps: { modelConfigured: false, employeeNetworkReady: false, peopleBound: false },
    } });
  });
}

/** Fulfill matching routes with an HTTP error status. */
export function mockApiError(page: Page, urlPattern: string, status = 500): void {
  page.route(urlPattern, async (route) => {
    await route.fulfill({
      status,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    });
  });
}

/** Abort matching routes to simulate network failure. */
export function mockNetworkFailure(page: Page, urlPattern: string): void {
  page.route(urlPattern, async (route) => {
    await route.abort('connectionrefused');
  });
}

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

/**
 * Inject a MockWebSocket into the page via addInitScript.
 * The latest instance is accessible at window.__mockWs from page.evaluate().
 *
 * Call BEFORE page.goto() so the mock is in place when the component creates
 * a WebSocket connection.
 */
/**
 * Set an auth token in localStorage so the Chat component can build a WS URL.
 * Uses addInitScript to inject the token before any page loads, so the token
 * is available immediately on navigation without needing a preliminary page visit.
 */
export async function setupToken(page: Page, token = 'test-token'): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem('admin_token', t);
  }, token);
}

export async function mockWebSocket(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url: string;
      readyState = MockWebSocket.CONNECTING;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;

      sentMessages: string[] = [];

      constructor(url: string) {
        this.url = url;
        (window as unknown as Record<string, unknown>).__mockWs = this;
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          if (this.onopen) this.onopen(new Event('open'));
        }, 0);
      }

      send(data: string): void {
        this.sentMessages.push(data);
      }

      close(): void {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose(new CloseEvent('close'));
      }

      receiveMessage(msg: Record<string, unknown>): void {
        if (this.onmessage && this.readyState === MockWebSocket.OPEN) {
          this.onmessage(new MessageEvent('message', { data: JSON.stringify(msg) }));
        }
      }

      simulateDisconnect(): void {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose(new CloseEvent('close'));
      }
    }

    (window as unknown as Record<string, unknown>).WebSocket = MockWebSocket;
  });
}
