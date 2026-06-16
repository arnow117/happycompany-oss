# Testing Patterns

**Analysis Date:** 2026-05-22

## Test Framework

**Runner:**
- Vitest 4.1.5 (backend and frontend)
- Backend config: `vitest.config.ts` at project root
- Frontend config: `web/vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`) with `@testing-library/jest-dom/vitest` for frontend DOM assertions

**Run Commands:**
```bash
# Backend (must run from project root)
cd happycompany && npm run test             # Run all backend tests
cd happycompany && npm run test:watch       # Watch mode
cd happycompany && npm run test:coverage    # Coverage report

# Frontend
cd happycompany/web && npm run test         # Run all frontend tests
cd happycompany/web && npm run test:watch   # Watch mode

# E2E
cd happycompany/web && npx playwright test  # Playwright E2E

# Task runner shortcuts
just server test        # Backend tests
just web test           # Frontend tests
just server pre-pr      # Backend: tsc + vitest (~30s)
just web pre-pr         # Frontend: tsc + build + vitest (~15s)
just pre-pr             # Full: both domains
just check              # Fast: only changed domains
```

## Test File Organization

**Location:**
- Backend: separate `tests/` directory at project root (NOT co-located with source)
- Frontend: co-located with source files (e.g., `web/src/pages/Login.test.tsx` next to `Login.tsx`)
- E2E: `web/e2e/` directory organized by story (`story-f-login/`, `story-j-chat/`)

**Naming:**
- Backend: `{module-name}.test.ts` (e.g., `tests/bot.test.ts`, `tests/auth-gate.test.ts`)
- Frontend: `{ComponentName}.test.tsx` (e.g., `Login.test.tsx`, `DashboardCards.test.tsx`)
- E2E: `story-{letter}-{name}.spec.ts` (e.g., `story-f-login/story-f.spec.ts`)

**Structure:**
```
tests/                              # Backend unit + integration tests (~60 files)
├── bot.test.ts                     # Per-module tests
├── schemas.test.ts
├── dedup.test.ts
├── api-integration/                # HTTP integration tests (server started globally)
│   ├── globalSetup.ts              # Starts test server on port 3100
│   ├── helpers.ts                  # HTTP helpers (getJSON, postJSON, etc.)
│   ├── admin-apps.test.ts
│   └── public-api.test.ts
└── orchestrator/                   # Orchestrator subsystem tests
    ├── employee-colony.test.ts
    ├── handoff-engine.test.ts
    └── orchestrator-runner.test.ts

web/src/                            # Frontend co-located tests
├── pages/
│   ├── Login.test.tsx
│   ├── Chat.test.tsx
│   └── EmployeeNetwork.test.tsx
└── components/
    ├── Layout.test.tsx
    └── OnboardingBanner.test.tsx

web/e2e/                            # Playwright E2E (23 test files, 20 stories)
├── helpers.ts                      # Shared helpers (mockAuth, mockWebSocket, screenshot)
├── global-setup.ts
├── story-f-login/story-f.spec.ts
└── story-j-chat/story-j.spec.ts
```

## Test Structure

**Suite Organization:**
```typescript
// Backend unit test pattern (from tests/dedup.test.ts)
import { describe, it, expect } from 'vitest';
import { DedupCache } from '../src/dedup.js';

describe('DedupCache', () => {
  it('returns true on first claim', () => {
    const cache = new DedupCache();
    const result = cache.claim('msg-001');
    expect(result).toBe(true);
  });
});
```

```typescript
// Frontend component test pattern (from web/src/pages/Login.test.tsx)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Login } from './Login';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { login: vi.fn() },
}));

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders admin console entry', () => {
    render(<BrowserRouter><Login /></BrowserRouter>);
    expect(screen.getByText('HappyCompany')).toBeInTheDocument();
  });
});
```

```typescript
// E2E test pattern (from web/e2e/story-f-login/story-f.spec.ts)
import { test, expect, type Page } from '@playwright/test';

test.describe('Story F: Login authentication', () => {
  test('successful login redirects to dashboard', async ({ page }) => {
    mockConfigured(page);
    mockSessionUnauthorized(page);
    // ...
  });
});
```

**Patterns:**
- **Setup**: `beforeEach` creates fresh instances or temp directories
- **Teardown**: `afterEach` cleans temp directories and closes resources (databases, files)
- **Test naming**: Descriptive phrases explaining expected behavior (`'returns true on first claim'`, `'rejects missing conversationId'`)
- **Section dividers**: `// ── Section Title ──` pattern groups related tests within a describe block

## Mocking

**Framework:** Vitest `vi` (built-in)

**Backend mocking patterns:**
```typescript
// Mock external channel dependencies (from tests/bot.test.ts)
function createMockChannel(name = 'feishu'): {
  channel: ChannelAdapter;
  triggerMessage: (msg: NormalizedMessage) => Promise<void>;
} {
  const channel: ChannelAdapter = {
    name,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn((handler) => { /* capture handler */ }),
    send: vi.fn(async (chatId, text) => { /* capture last sent */ }),
    // ...
  };
  return { channel, triggerMessage, getLastSent };
}

// Mock agent factory
function createMockAgentFactory() {
  return {
    agent: {
      respond: vi.fn().mockResolvedValue('Agent reply here.'),
      clearSession: vi.fn(),
    },
  };
}
```

**Frontend mocking patterns:**
```typescript
// Mock child components (from web/src/pages/Chat.test.tsx)
vi.mock('../components/chat/ChatView', () => ({
  ChatView: ({ selectedWorkdir }: { selectedWorkdir: string }) => (
    <div data-testid="selected-workdir">{selectedWorkdir}</div>
  ),
}));

// Mock API modules (from web/src/pages/Login.test.tsx)
vi.mock('../lib/api', () => ({
  api: { login: vi.fn() },
}));
vi.mock('../lib/auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));
```

**E2E mocking patterns (Playwright route interception):**
```typescript
// Mock API responses (from web/e2e/helpers.ts)
export function mockAuth(page: Page, bots = [DEFAULT_BOT]): void {
  page.route('**/api/setup/status', async (route) => {
    await route.fulfill({ json: { configured: true, needsApiKey: false, hasBots: true } });
  });
  page.route('**/api/health', async (route) => {
    await route.fulfill({ json: { status: 'ok', bots } });
  });
}

// Mock WebSocket (injected via addInitScript)
export async function mockWebSocket(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class MockWebSocket { /* ... */ }
    window.WebSocket = MockWebSocket;
  });
}
```

**What to Mock:**
- External API calls (DingTalk, Feishu/Lark SDK)
- LLM API calls (Anthropic SDK via agent factory)
- WebSocket connections
- File system operations (use temp directories instead of mocking)
- Child React components when testing parent routing/state logic

**What NOT to Mock:**
- Internal module-to-module calls (test real interactions)
- Zod schemas (test actual validation)
- Business logic functions (test real implementations)
- Database operations (use real SQLite with temp files)

## Fixtures and Factories

**Test Data:**
```typescript
// Factory helpers for creating test fixtures (from tests/bot.test.ts)
function makeBotConfig(overrides?: Partial<BotConfig>): BotConfig {
  return {
    channel: 'feishu',
    credentials: { appId: 'test' },
    displayName: 'Test Bot',
    agentDir: '/tmp/test-agent',
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: 'msg-001',
    chatId: 'chat-001',
    text: 'hello',
    source: 'user',
    channelId: 'feishu',
    receivedAt: 1000,
    ...overrides,
  };
}
```

```typescript
// Filesystem fixtures with temp directories (from tests/skill-validator.test.ts)
let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'skill-validator-test-'));
});

afterEach(() => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

function createTestSkill(overrides: Partial<ScannedSkill> = {}): ScannedSkill {
  return {
    name: 'test-skill',
    description: 'A test skill',
    path: path.join(testDir, '.claude', 'skills', 'test-skill'),
    hasWriteOps: false,
    ...overrides,
  };
}
```

```typescript
// Database fixtures with temp files (from tests/store.test.ts)
const TEST_DB = '/tmp/happycompany-test-store.db';

beforeEach(() => {
  cleanDb();
  store = new MessageStore(TEST_DB);
});

afterEach(() => {
  store.close();
  cleanDb();
});
```

**Location:**
- Factory functions defined at top of test file (not shared across files)
- Each test file owns its own `make*` and `create*` helpers
- E2E shared helpers in `web/e2e/helpers.ts`

## Coverage

**Requirements:**
- Coverage thresholds configured in `vitest.config.ts`:
  - Statements: 65%
  - Branches: 55%
  - Functions: 45%
  - Lines: 68%
- These are minimum thresholds, not aspirational targets

**View Coverage:**
```bash
cd happycompany && npm run test:coverage    # V8 coverage provider
```

**Config:**
```typescript
// From vitest.config.ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  include: ['src/**/*.ts'],
  exclude: ['src/logger.ts'],
}
```

## Test Types

**Unit Tests:**
- Scope: Individual functions, classes, schemas
- Location: `tests/{module}.test.ts`
- Pattern: Direct imports from `../src/`, no server needed
- Count: ~60 backend unit test files, ~15 frontend unit test files
- Examples: `tests/dedup.test.ts`, `tests/schemas.test.ts`, `web/src/components/Layout.test.tsx`

**Integration Tests:**
- Scope: Full HTTP API endpoints against running server
- Location: `tests/api-integration/*.test.ts`
- Pattern: Server started once by `globalSetup.ts`, tests make HTTP requests
- Server lifecycle: `globalSetup` spawns `tsx src/index.ts`, `globalTeardown` kills it
- Bypass via env: `VITEST_SKIP_GLOBAL_SETUP=1` skips server startup
- Helpers: `getJSON()`, `postJSON()`, `putJSON()`, `delJSON()` in `tests/api-integration/helpers.ts`
- Base URL: `http://127.0.0.1:3100`
- Config isolation: Uses `config.test.json` (copied from `config.json`) to avoid mutating real config
- Count: ~10 integration test files

**E2E Tests:**
- Framework: Playwright
- Location: `web/e2e/` organized by story (20 story directories)
- Pattern: API routes mocked with `page.route()`, WebSocket mocked with `addInitScript`
- Screenshots: Saved to `web/e2e/{story-dir}/__screenshots/`
- Helpers: `web/e2e/helpers.ts` provides `mockAuth()`, `mockWebSocket()`, `setupToken()`, `screenshot()`
- Count: ~23 E2E test files

## Common Patterns

**Async Testing:**
```typescript
// Waiting for async operations in tests
await waitFor(() => {
  expect(screen.getByTestId('selected-workdir')).toHaveTextContent('acme');
});
```

**Error Testing:**
```typescript
// Schema validation error testing
it('rejects missing chat_id', () => {
  const result = feishuMessageEventSchema.safeParse(event);
  expect(result.success).toBe(false);
});

// Exception testing
it('should throw error for non-existent path', () => {
  expect(() => scanner.scan(nonExistent)).toThrow('Workdir does not exist');
});
```

**Resource Cleanup:**
```typescript
// Temp directory pattern (used consistently)
let testDir: string;
beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(tmpdir(), 'prefix-'));
});
afterEach(() => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
});

// Database cleanup pattern
let store: MessageStore;
beforeEach(() => { cleanDb(); store = new MessageStore(TEST_DB); });
afterEach(() => { store.close(); cleanDb(); });
```

**Zustand Store Testing:**
```typescript
// Directly set store state for test isolation (from web/src/pages/Chat.test.tsx)
beforeEach(() => {
  sessionStorage.clear();
  useChatStore.setState({
    connected: false,
    messages: [],
    selectedWorkdir: 'web',
    chatId: 'web-initial',
    // ...
  });
});

// Assert store state after interaction
const state = useChatStore.getState();
expect(state.selectedWorkdir).toBe('acme');
```

---

*Testing analysis: 2026-05-22*
