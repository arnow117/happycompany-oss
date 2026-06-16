# Codebase Concerns

**Analysis Date:** 2026-05-22

## Tech Debt

**Oversized Backend Files (exceed 800-line limit):**
- Issue: `src/dingtalk.ts` (1008 lines) and `src/feishu.ts` (815 lines) exceed the project's 800-line file limit. `src/feishu-cards/sections.ts` (581 lines) and `src/index.ts` (677 lines) are approaching the threshold. Per `src/CLAUDE.md`, modifying dingtalk.ts or feishu.ts should prioritize extracting shared logic to `im-utils.ts`.
- Files: `src/dingtalk.ts`, `src/feishu.ts`
- Impact: Harder to navigate, review, and test. Increased merge conflict surface.
- Fix approach: Extract shared channel adapter utilities (message splitting, markdown conversion, file handling) into `src/im-utils.ts` or smaller focused modules. Target each file below 800 lines.

**Oversized Frontend Files (exceed 800-line limit):**
- Issue: `web/src/pages/EmployeeNetwork.tsx` (1155 lines) and `web/src/pages/Config.tsx` (849 lines) far exceed the 800-line limit. Multiple other pages approach or exceed 400 lines: `SkillsMarketplace.tsx` (659), `Setup.tsx` (605), `Layout.tsx` (597), `ModelConfig.tsx` (505).
- Files: `web/src/pages/EmployeeNetwork.tsx`, `web/src/pages/Config.tsx`
- Impact: Component complexity makes maintenance and testing harder. State logic mixed with rendering.
- Fix approach: Extract sub-components, custom hooks, and utility functions from large pages. For EmployeeNetwork.tsx, split template browsing, employee listing, and scan results into separate components. For Config.tsx, extract form sections.

**`SdkMcpToolDefinition<any>` Type Usage:**
- Issue: Five functions in `src/mcp-tools.ts` and `src/orchestrator/skill-bridge.ts` use `SdkMcpToolDefinition<any>`, violating the project rule against introducing `any` types. The SDK's generic type parameter is left untyped.
- Files: `src/mcp-tools.ts` (lines 12, 61, 290), `src/orchestrator/skill-bridge.ts` (lines 63, 84)
- Impact: Loses type safety for tool definitions. Tool parameter shapes are unchecked at compile time.
- Fix approach: Define a concrete type parameter for the SDK tool definition generic, or use `unknown` with proper narrowing if the SDK allows.

**Pervasive Synchronous File I/O:**
- Issue: The codebase uses `readFileSync` / `writeFileSync` extensively (30+ call sites across 15+ files). This blocks the Node.js event loop. Hot paths like config loading, tenant scanning, and template rendering all use sync I/O.
- Files: `src/enterprise-people.ts` (lines 178, 204), `src/agent.ts` (lines 124, 292, 306), `src/template-loader.ts` (lines 43, 68, 76, 86, 126, 131, 149), `src/config.ts` (lines 134, 151), `src/tenant.ts` (lines 42, 56), `src/tool-registry.ts` (line 58)
- Impact: Under concurrent load (multiple API requests, channel messages), sync I/O blocks all other requests. Could cause noticeable latency spikes.
- Fix approach: Migrate hot paths to async `fs/promises` (`readFile`, `writeFile`). Prioritize paths called during request handling (tenant lookups, config reads). Startup-only paths (initial config load, template scanning) are acceptable as sync.

**98 Type Assertions on Parsed JSON:**
- Issue: The codebase has 98 `as Record<...>`, `as Array<...>`, `as unknown` type assertions. Several of these are applied to `JSON.parse()` results or `c.req.json()` without schema validation, bypassing runtime safety.
- Files: `src/ws.ts` (line 49), `src/routes/admin-config.ts` (line 18), `src/routes/admin-operations.ts` (line 85), `src/feishu.ts` (line 599), `src/orchestrator/employee-api.ts` (lines 444, 459)
- Impact: Malformed request bodies or corrupted JSON files will cause runtime crashes instead of clean validation errors.
- Fix approach: Apply Zod schema validation at API boundaries (routes) before type assertions. The project already uses Zod extensively (`src/schemas.ts`, `src/config.ts`) -- extend this pattern to all `c.req.json()` calls.

## Known Bugs

**Empty Catch Blocks Silently Swallow Errors:**
- Symptoms: Errors in channel-specific operations (DingTalk card completion, Feishu reaction removal, DingTalk message sending) are silently ignored with `.catch(() => {})`. Frontend API calls similarly swallow errors (Config, ModelConfig, SkillsMarketplace, OnboardingBanner).
- Files: `src/dingtalk.ts` (lines 317, 326, 337, 347, 747), `src/feishu.ts` (line 232), `src/agent.ts` (line 258), `web/src/pages/Config.tsx` (line 56), `web/src/pages/ModelConfig.tsx` (line 36), `web/src/pages/SkillsMarketplace.tsx` (line 68)
- Trigger: Network failures, API rate limits, or malformed responses from DingTalk/Feishu will silently fail without logging or user notification.
- Workaround: None -- failures are invisible to operators.

**Backup File in Source Directory:**
- Symptoms: `web/src/App.tsx.bak` is a stale backup file in the source tree. It is tracked by git (shown in git status as `A`).
- Files: `web/src/App.tsx.bak`
- Trigger: N/A -- artifact from a previous edit session.
- Workaround: Delete the file and remove from git tracking.

## Security Considerations

**CORS Configured as Wildcard:**
- Risk: `src/web.ts` (line 72) uses `cors()` with no origin restriction, allowing any domain to make API requests. In production, this enables CSRF and data exfiltration from any origin.
- Files: `src/web.ts`
- Current mitigation: Admin routes are protected by Bearer token auth (when `adminToken` is configured). Public routes are intentionally open.
- Recommendations: Restrict CORS to the frontend origin in production (`cors({ origin: 'http://localhost:3100' })` or the deployed domain). At minimum, add an environment-configurable allowed origin.

**Timing-Unsafe Token Comparison:**
- Risk: `src/web.ts` (line 100) compares the admin token using strict equality (`authHeader !== \`Bearer ${deps.adminToken}\``). This is vulnerable to timing attacks where an attacker can measure response times to gradually discover the token character by character.
- Files: `src/web.ts` (line 100)
- Current mitigation: The token is transmitted over HTTPS (assumed). The attack requires many requests and precise timing.
- Recommendations: Use `crypto.timingSafeEqual()` for token comparison. Convert both strings to `Buffer` and compare with constant-time equality.

**Setup API Has No Authentication:**
- Risk: `src/routes/admin-config.ts` (lines 125-209) exposes `/api/setup/config` and `/api/setup/status` without authentication. The comment says "first-run only" but there is no server-side gate preventing repeated access. Rate limiting is IP-based with a weak limit (10 requests per 60 seconds). An attacker could brute-force API keys or overwrite the system configuration.
- Files: `src/routes/admin-config.ts` (lines 125-209)
- Current mitigation: Checks if system is already configured and returns 403, but the `X-Force-Setup` header can bypass this. Rate limit of 10 req/60s is generous.
- Recommendations: Disable setup endpoints after first configuration is complete (require server restart to re-enable). Remove or protect the `X-Force-Setup` bypass. Add stricter rate limiting (3 attempts per 5 minutes).

**API Keys Written Directly to process.env:**
- Risk: `src/routes/admin-config.ts` (lines 81-83, 241-243) and `src/index.ts` (lines 144, 147, 150, 556-558) set `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_AUTH_TOKEN` directly into `process.env`. If any unhandled error includes environment variables in its output, or if a child process inherits env, the keys could leak.
- Files: `src/routes/admin-config.ts`, `src/index.ts`
- Current mitigation: `src/env-guard.ts` sanitizes env vars before passing to child processes. Config file uses encryption for credentials (`src/crypto.ts`).
- Recommendations: Consider storing API keys in a runtime secrets manager rather than `process.env`. At minimum, ensure no error handlers log the full `process.env`.

**No Global unhandledRejection / uncaughtException Handler:**
- Risk: The application does not register `process.on('unhandledRejection', ...)` or `process.on('uncaughtException', ...)`. Unhandled promise rejections can crash the process silently without logging.
- Files: `src/index.ts` (main entry point)
- Current mitigation: Individual try/catch blocks in most async paths.
- Recommendations: Add global error handlers at process startup that log via Pino and optionally perform graceful shutdown.

**WebSocket Has No Authentication:**
- Risk: `src/ws.ts` accepts WebSocket connections without any authentication or origin validation. Any client that can reach `/api/ws` can send chat messages, inject content into conversations, and receive streaming responses.
- Files: `src/ws.ts` (lines 20-26)
- Current mitigation: Assumes the server is on a trusted network.
- Recommendations: Validate the `Origin` header on WebSocket upgrade. Require a valid session token before allowing chat messages. At minimum, validate that the `workdirId` refers to an existing bot.

## Performance Bottlenecks

**Sync File I/O on Request Hot Path:**
- Problem: Every request that reads config, tenant data, or employee files blocks the event loop. `src/tenant.ts` uses `fs.readdirSync` and `fs.readFileSync` during tenant scanning. `src/enterprise-people.ts` uses `fs.readFileSync` when resolving people bindings.
- Files: `src/tenant.ts` (lines 30, 42, 56), `src/enterprise-people.ts` (line 178), `src/routes/admin-config.ts` (lines 155, 181)
- Cause: Synchronous file operations in request handlers and service initialization.
- Improvement path: Cache tenant and people data in memory with file watchers for invalidation. Convert hot-path reads to async `fs/promises`. The `TemplateLoader` already does some caching -- extend this pattern.

**O(n) Tenant and People Lookups:**
- Problem: `src/routes/admin-config.ts` (lines 154-169, 176-193) iterates all tenant directories and reads all `people.json` files on every `/api/setup/status` GET request. With many tenants, this becomes expensive.
- Files: `src/routes/admin-config.ts` (lines 154-193)
- Cause: No caching of tenant scan results. Full filesystem scan per request.
- Improvement path: Cache the setup status result with a short TTL (5 seconds) or invalidate on config change events via the MessageBus.

**DingTalk Streaming Card Throttle at 500ms:**
- Problem: `src/dingtalk-card.ts` (line 31) uses a 500ms interval for streaming card updates, limiting to 2 QPS. Long agent responses will feel sluggish.
- Files: `src/dingtalk-card.ts` (line 31)
- Cause: DingTalk platform API rate limit.
- Improvement path: This is a platform constraint. Consider batching more content per update to reduce perceived latency. Buffer intelligently to send meaningful chunks.

## Fragile Areas

**Channel Adapter Integration (DingTalk / Feishu):**
- Files: `src/dingtalk.ts` (1008 lines), `src/feishu.ts` (815 lines), `src/feishu-cards/sections.ts` (581 lines), `src/dingtalk-card.ts` (534 lines)
- Why fragile: These files are the largest in the codebase and handle complex third-party API integrations (DingTalk stream protocol, Feishu card rendering, token management, message parsing). They have zero direct test coverage (no corresponding test files in `tests/`).
- Safe modification: Always test against real DingTalk/Feishu sandbox environments. Extract changes into small, testable utility functions first.
- Test coverage: No unit tests for `dingtalk.ts`, `feishu.ts`, `dingtalk-card.ts`, `streaming-card.ts`, `feishu-parse.ts`, `feishu-markdown-style.ts`, or `feishu-cards/*`. This is the largest test coverage gap in the codebase.

**Orchestrator Subsystem:**
- Files: `src/orchestrator/handoff-engine.ts` (562 lines), `src/orchestrator/employee-api.ts` (572 lines), `src/orchestrator/employee-generator.ts` (508 lines)
- Why fragile: The orchestrator manages multi-agent handoff loops, contract lifecycle, and employee generation. The handoff engine has complex state management (pending contracts, agent registry, allowed targets) and multiple failure modes (loop detection, max iterations, security errors).
- Safe modification: Only modify through the documented entry points (`orchestrator-runner.ts`, `employee-api.ts`). Never import internal orchestrator modules from outside.
- Test coverage: Good -- `tests/orchestrator/` directory has dedicated tests. Maintain this coverage when modifying.

**Frontend API Client:**
- Files: `web/src/lib/api.ts` (674 lines)
- Why fragile: This is the single centralized API client that all 18 pages depend on. Any change to request/response types or error handling affects every page. The file contains 674 lines of type definitions and method signatures.
- Safe modification: Add new types at the top, add new methods at the bottom. Never modify existing method signatures without updating all consuming pages.
- Test coverage: No dedicated test file for `api.ts` itself.

## Scaling Limits

**In-Memory Rate Limiting:**
- Current capacity: Setup API rate limiting uses an in-memory `Map<string, number>` (`src/routes/admin-config.ts` line 127). Only tracks IP + timestamp.
- Limit: Lost on process restart. Does not work across multiple server instances. Memory grows unbounded (no eviction of old entries).
- Scaling path: Use a proper rate limiter middleware (e.g., `hono-rate-limiter` or Redis-backed store). Add TTL-based eviction for the current Map.

**SQLite as Primary Data Store:**
- Current capacity: `src/store.ts` uses SQLite via `better-sqlite3` for message persistence, scheduled tasks, and contract storage. Single file database.
- Limit: SQLite does not support concurrent writes from multiple processes. If the server is scaled horizontally or if background workers need write access, this becomes a bottleneck.
- Scaling path: For current single-instance deployment, SQLite is appropriate. If horizontal scaling is needed, migrate to PostgreSQL with proper connection pooling.

**WebSocket Connection Scaling:**
- Current capacity: `src/ws.ts` stores pending chats in an in-memory `Map<string, PendingChat>`. No limit on concurrent connections or pending chats.
- Limit: Memory grows with connections. No backpressure mechanism. No connection timeout/cleanup for stale WebSocket clients.
- Scaling path: Add a max concurrent connections limit. Implement heartbeat/ping-pong for stale connection detection. Consider `ws.setMaxListeners()` and connection counting.

## Dependencies at Risk

**Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`):**
- Risk: The core agent functionality depends on the Claude Agent SDK, which appears to be a specialized/proprietary package. SDK API changes could break `src/agent.ts`, `src/mcp-tools.ts`, and the orchestrator bridge.
- Impact: All LLM interactions, tool execution, and multi-agent orchestration would be affected.
- Migration plan: Pin the SDK version in `package.json`. Create an abstraction layer in `src/agent.ts` to isolate SDK-specific types and methods.

**DingTalk Stream Stub:**
- Risk: `src/dingtalk-stream-stub.ts` is imported by `src/dingtalk.ts` but has no test coverage and appears to be a custom integration layer.
- Impact: DingTalk channel would break if the stream protocol changes.
- Migration plan: Monitor DingTalk API changelog. Add integration tests that verify stream protocol assumptions.

## Missing Critical Features

**No Automated CI/CD Pipeline:**
- Problem: No CI configuration files detected (no `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, etc.). All testing and quality checks are manual via `just check` and `just pre-pr`.
- Blocks: Automated quality gates on pull requests. Deployment confidence.

**No Health Check Endpoints for Channel Adapters:**
- Problem: There is a `/api/health` endpoint, but no dedicated health checks for DingTalk or Feishu channel connections. Token expiry, stream disconnections, or API outages are not proactively detected.
- Blocks: Monitoring dashboards, automated alerting for channel failures.

## Test Coverage Gaps

**Channel Adapters (Zero Coverage):**
- What's not tested: DingTalk message handling, token caching, streaming cards, file downloads, reaction management. Feishu card building, markdown conversion, event parsing.
- Files: `src/dingtalk.ts`, `src/feishu.ts`, `src/dingtalk-card.ts`, `src/streaming-card.ts`, `src/feishu-parse.ts`, `src/feishu-markdown-style.ts`, `src/feishu-cards/builder.ts`, `src/feishu-cards/sections.ts`
- Risk: High -- channel adapters are the user-facing interface. Bugs here directly impact end users on DingTalk/Feishu. Changes to third-party API behavior will go undetected.
- Priority: High

**Route Handlers (Partial Coverage):**
- What's not tested: `src/routes/admin-skills.ts`, `src/routes/admin-operations.ts`, `src/routes/workflows.ts`, `src/routes/admin-knowledge.ts`, `src/routes/public-routes.ts`, `src/routes/templates.ts`, `src/routes/bot-bindings.ts`, `src/routes/enterprise-people.ts`
- Files: `src/routes/` (8 of ~11 route files untested)
- Risk: Medium -- route handlers contain business logic, auth checks, and input validation. Untested routes may have incorrect error handling or missing validation.
- Priority: Medium

**Frontend Pages (13 of 18+ Uncovered):**
- What's not tested: `web/src/pages/Bots.tsx`, `Sessions.tsx`, `EnterprisePeople.tsx`, `Workflows.tsx`, `Dashboard.tsx`, `Employees.tsx`, `Scheduler.tsx`, `Stats.tsx`, `KnowledgeBase.tsx`, `Onboarding.tsx`, `SkillsMarketplace.tsx`, `NotFound.tsx`, `Memory.tsx`
- Files: 13 page components in `web/src/pages/`
- Risk: Medium -- E2E tests cover some user flows, but unit tests catch regressions earlier and cheaper.
- Priority: Medium

**Core Infrastructure Modules (Partial Coverage):**
- What's not tested: `src/enterprise-routing.ts`, `src/web.ts`, `src/ws.ts`, `src/knowledge-resolver.ts`, `src/template-loader.ts`, `src/app-runner.ts`, `src/app-server.ts`
- Files: 7 core infrastructure modules
- Risk: Medium -- these modules handle routing, WebSocket communication, knowledge management, and app execution. `ws.ts` and `app-runner.ts` in particular handle untrusted input.
- Priority: Medium

---

*Concerns audit: 2026-05-22*
