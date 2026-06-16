# Test Report — 2026-05-10

**Run**: Full test suite (vitest run)
**Result**: 76 files, 929 passed, 2 skipped, 0 failed

## Summary

| Metric | Value |
|--------|-------|
| Test files | 76 |
| Tests passed | 929 |
| Tests skipped | 2 (Playwright browser tests, require running server) |
| Tests failed | 0 |
| Duration | 13.25s |
| Baseline | 931 (matches CLAUDE.md) |

## New Tests Added (This Session)

### config.test.ts (21 tests)
- Config state management (provider mode detection, form state)
- API data unwrapping (claude key, bot conversion)
- Read-only display rendering (third_party mode, official mode)
- Edit mode toggle (form fields, cancel/save flow)
- Bot management (add, edit, delete, credential display)

### web-e2e.test.ts (7 tests, 2 skipped)
- API endpoint validation (health, bots, chats, scheduler)
- Chat messages API structure
- 404 for unknown routes
- CORS headers
- ~~Web UI HTML rendering~~ (skipped - requires Playwright)
- ~~Web UI chat list~~ (skipped - requires Playwright)

### web-navigation.test.tsx
- Route rendering (all pages mount without crash)
- Navigation link structure verification

## Existing Test Coverage (Unchanged)

All 73 pre-existing test files continue to pass:
- Bot, Agent, Channel, MessageStore, Bus, DedupCache
- ToolRegistry, Knowledge, AuthGate, Tenant, Config
- AppServer, BusinessAPI, Scheduler, Analytics
- Integration tests, Phase 0-4 pipeline test

## Skipped Tests

| Test | Reason |
|------|--------|
| web UI loads with proper HTML | Requires Playwright browser + running server |
| web UI renders chat list | Requires Playwright browser + running server |

Run with: `npx vitest run tests/web-e2e.test.ts` (when server is live)

## API Smoke Test Results

12 endpoints tested against live backend (port 3100):

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET /api/health | 200 | Bot info returned |
| GET /api/setup/status | 200 | configured=false, hasBots=true |
| GET /api/admin/config | 200 | claude nested correctly |
| GET /api/admin/apps | 200 | Empty array |
| GET /api/admin/skills | 200 | Skills listed |
| GET /api/business/agents | 200 | Agent with sessions |
| GET /api/business/channels | 200 | Channel summary |
| GET /api/business/contract-chain | 200 | Combined view |
| GET /api/admin/analytics/usage | 200 | Usage stats |
| GET /api/admin/analytics/skills | 200 | Empty array |
| GET /api/admin/scheduler/tasks | 200 | Tasks listed |
| GET /api/admin/insights | 200 | Empty array |

## Bug Found During Testing

### SPA 404 on root path (FIXED)
- **Symptom**: http://localhost:3100/ returned "Not Found"
- **Root cause**: `path.resolve(distDir, '/')` resolved to filesystem root `/` instead of dist dir
- **Fix**: Changed to `path.join(distDir, c.req.path)` in src/web.ts
- **Impact**: All non-API routes were broken

## Build Verification

| Check | Result |
|-------|--------|
| Backend TS (tsc --noEmit) | Pass |
| Frontend TS (tsc --noEmit) | Pass |
| Frontend build (vite build) | Pass |
| Test suite (vitest run) | Pass (929/931) |
