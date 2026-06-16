# Testing Strategy — Happy Company

> **Version:** 2026-05-10
> **Status:** Active
> **Approach:** GAN + Team (Generator-Evaluator adversarial loop with parallel agents)

## Problem Statement

Prior to this strategy, 929 tests existed but **all were mock-based**. No test started a real server or made real HTTP requests. This caused a critical SPA 404 bug (root path `/` returned "Not Found" due to `path.resolve` vs `path.join`) to exist undetected. The fundamental issue: tests verified code in isolation but never verified that components worked together as a system.

## Test Pyramid

```
            ┌───────────────────────┐
            │     B-End E2E (5%)    │  Playwright, 业务场景
            │     ~10-15 tests      │  登录→配置→聊天→发布→统计
            ├───────────────────────────────────┤
            │     API Integration (20%)         │  真实 HTTP 请求
            │     ~80-100 tests                  │  每个端点一个测试
            ├───────────────────────────────────┤
            │     Unit Tests (75%)              │  Mock-based
            │     ~900 tests                     │  函数、组件、模块
            └───────────────────────────────────┘
```

**Key principle:** The higher the layer, the more likely it catches integration bugs. Unit tests are necessary but insufficient — they prove modules work in isolation, not that they connect correctly.

## Coverage Targets

| Dimension | Baseline (2026-05-10) | Target |
|-----------|----------------------|--------|
| API endpoints with tests | 20/80 (25%) | 72/80 (90%) |
| Auth middleware tested | 0/55 (0%) | 55/55 (100%) |
| POST/PUT/DELETE tested | 5/25 (20%) | 22/25 (88%) |
| B-End E2E scenarios | 0/7 (0%) | 7/7 (100%) |
| WebSocket tested | 0 | Basic connection test |
| Overall test count | 951 | 1050+ |

## GAN + Team Workflow

### Why GAN (Generative Adversarial)

Traditional approach: Write all tests once, run once. Problem: blind spots persist.

GAN approach: Generator writes tests → Evaluator finds gaps → Generator improves → Loop.

The evaluator catches what the generator misses — exactly the class of bug (SPA 404) that slipped through before.

### Why Team (Parallel Agents)

Generator step is embarrassingly parallel — different API groups can be tested independently. Team mode lets 3-5 generators work simultaneously, then a single evaluator assesses all results.

### Loop Structure

```
Iteration N:
  1. Dispatch 3-5 Generator agents in parallel (each handles an API group)
  2. Wait for all generators to finish and commit
  3. Dispatch 1 Evaluator agent:
     - Run `npx vitest run --coverage`
     - Start real server, run `server-integration.test.ts`
     - Score against rubric
     - Write feedback to gan-harness/feedback/feedback-{N}.md
  4. Check score:
     - Score >= 7.0 → PASS
     - 3 iterations without improvement → PLATEAU, stop
     - Otherwise → next iteration, generators read feedback
```

### Evaluation Rubric

```markdown
### API Endpoint Coverage (weight: 0.30)
- Each tested endpoint (GET/POST/PUT/DELETE with assertions) = 1 point
- Bonus for auth header testing on protected endpoints

### Authentication Path Coverage (weight: 0.20)
- 401 rejection without token = 1 point per admin endpoint group
- 200 success with valid token = 1 point per group
- Missing token in body = 1 point per group

### B-End E2E Scenario Coverage (weight: 0.25)
- Each complete user workflow (multi-step, cross-endpoint) = 1 point
- Must include: setup → action → verification → cleanup

### Test Quality (weight: 0.25)
- Descriptive test names (not "test 1")
- AAA pattern (Arrange-Act-Assert)
- Edge cases: empty input, invalid input, boundary values
- No shared mutable state between tests
- Proper error assertions (status code + body shape)
```

### Score Scale

| Range | Meaning |
|-------|---------|
| 0-3.0 | Critical gaps, many untested endpoints |
| 3-5.0 | Basic coverage but missing auth, mutations, E2E |
| 5-7.0 | Good coverage, some edge cases missing |
| 7-8.5 | Strong coverage, production-ready |
| 8.5-10.0 | Excellent, exceeds targets |

### Pass Threshold: 7.0

## Test Categories

### Layer 1: API Integration Tests (real HTTP)

**Pattern:** Start real server with `spawn('node', ['dist/index.js'])`, make `fetch()` requests, assert response.

**File:** `tests/api-integration/`

**Groups:**
- `admin-config.test.ts` — POST/GET admin/config, auth verification
- `admin-apps.test.ts` — GET/POST/DELETE admin/apps/*, publish/rollback/install
- `admin-scheduler.test.ts` — CRUD scheduler/tasks, trigger
- `admin-memory.test.ts` — GET/PUT/DELETE memory files
- `admin-build.test.ts` — POST build, GET status, publish
- `admin-workdir.test.ts` — CRUD workdir, skills, versions
- `admin-scaffold.test.ts` — scaffold types, create
- `admin-insights.test.ts` — generate, list, update status
- `auth-middleware.test.ts` — 401 without token, 200 with token, invalid token
- `setup.test.ts` — GET/POST setup/config, setup/status
- `public-api.test.ts` — health, bots, chats, sessions, workdirs

### Layer 2: Server Integration Tests (full stack)

**Pattern:** Existing `tests/server-integration.test.ts` — verifies SPA serving, PWA assets, CORS.

**Already covers:** 22 tests for SPA, PWA, static assets, security headers.

### Layer 3: B-End E2E Tests (business workflows)

**Pattern:** Playwright or HTTP flow tests — multi-step scenarios crossing multiple endpoints.

**File:** `tests/e2e/`

**Scenarios:**
1. Admin configures Claude model → verifies via GET
2. Admin creates/edits/deletes a bot → verifies in health endpoint
3. Admin publishes an app version → verifies in version list
4. Admin manages scheduler tasks (create/trigger/complete)
5. Admin views analytics → verifies data shape
6. User sends chat message → verifies message stored
7. Full setup flow (first-time config → bot creation → health check)

### Layer 4: Unit Tests (existing, mock-based)

**Status:** 951 tests, no changes needed. These verify individual module logic.

## File Organization

```
happycompany/
├── docs/superpowers/specs/
│   ├── 2026-05-10-testing-strategy.md      ← This document
│   └── 2026-05-10-test-coverage-report.md  ← Final report (after GAN loop)
├── gan-harness/
│   ├── spec.md                              ← Complete API endpoint inventory
│   ├── eval-rubric.md                       ← Scoring criteria
│   ├── feedback/
│   │   ├── feedback-001.md                  ← Evaluator feedback per iteration
│   │   ├── feedback-002.md
│   │   └── ...
│   └── build-report.md                      ← Final scores and progression
├── tests/
│   ├── api-integration/                     ← NEW: Real HTTP integration tests
│   │   ├── admin-config.test.ts
│   │   ├── admin-apps.test.ts
│   │   ├── admin-scheduler.test.ts
│   │   ├── admin-memory.test.ts
│   │   ├── admin-build.test.ts
│   │   ├── admin-workdir.test.ts
│   │   ├── admin-scaffold.test.ts
│   │   ├── admin-insights.test.ts
│   │   ├── auth-middleware.test.ts
│   │   ├── setup.test.ts
│   │   └── public-api.test.ts
│   ├── e2e/                                 ← NEW: B-End E2E scenarios
│   │   ├── admin-config-flow.test.ts
│   │   ├── bot-management-flow.test.ts
│   │   ├── app-publish-flow.test.ts
│   │   ├── scheduler-management-flow.test.ts
│   │   ├── analytics-flow.test.ts
│   │   ├── chat-message-flow.test.ts
│   │   └── full-setup-flow.test.ts
│   ├── server-integration.test.ts           ← Existing: SPA + PWA (22 tests)
│   └── web-e2e.test.ts                     ← Existing: partial E2E (5 tests)
```

## Anti-Patterns (Lessons Learned)

| Anti-Pattern | What Happened | Fix |
|-------------|---------------|-----|
| Mock-only testing | 929 tests, zero real HTTP requests | Add server-integration.test.ts |
| No root path test | `/` returned 404, undetected for weeks | Test every SPA route including `/` |
| `cwd` assumption | Test used `import.meta.dirname` → resolved to `tests/` | Use `PROJECT_ROOT` from `dirname(dirname(...))` |
| PORT env var assumption | Server reads from config.json, not `process.env.PORT` | `killPort()` before starting test server |
| Auth never tested | 55 admin endpoints, 0 auth tests | Explicit 401/200 test pairs |
| Test count != coverage | 929 tests but only 25% endpoints covered | Track endpoint coverage, not test count |

## Reusability

This strategy document is project-agnostic. To adapt to another project:

1. Replace the endpoint inventory in `gan-harness/spec.md`
2. Adjust coverage targets
3. Add project-specific anti-patterns
4. Keep the GAN + Team loop structure unchanged
