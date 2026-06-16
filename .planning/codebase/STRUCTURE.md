# Codebase Structure

**Analysis Date:** 2026-05-22

## Directory Layout

```
happycompany/
├── src/                        # Backend (Node.js + TypeScript + Hono)
│   ├── orchestrator/           # Self-contained multi-agent orchestration subsystem
│   ├── routes/                 # Admin API route modules (Hono)
│   ├── prompts/                # Prompt template system (templates + snippets)
│   ├── feishu-cards/           # Feishu interactive card builders
│   └── *.ts                    # Core modules (agent, bot, store, bus, channels, etc.)
├── web/                        # Frontend (React + TypeScript + Vite)
│   ├── src/
│   │   ├── pages/              # 18 page components (one .tsx per page)
│   │   ├── components/         # Shared UI components (chat, skill-marketplace, demo)
│   │   ├── stores/             # Zustand state management (1 store: chat.ts)
│   │   ├── hooks/              # Custom React hooks (useWebSocket)
│   │   ├── lib/                # API client, auth, utilities
│   │   ├── types/              # TypeScript type definitions
│   │   └── styles/             # CSS (tokens.css + global.css)
│   └── e2e/                    # Playwright E2E tests (22 story directories)
├── corp/                       # Multi-tenant data (filesystem-based)
│   ├── {tenant}/               # One directory per tenant (e.g., acme)
│   │   ├── employees/          # Employee YAML definitions
│   │   ├── agents/             # Agent workdirs (worktree directories)
│   │   ├── apps/               # Tenant-scoped apps (symlinks or dirs)
│   │   ├── knowledge/          # Tenant knowledge base files
│   │   ├── roles.json          # RBAC role definitions
│   │   └── people.json         # Enterprise people bindings
│   └── templates/              # Industry templates
│       └── industries/
│           ├── general/
│           └── med-device/     # Medical device industry template
├── apps/                       # Global tenant apps (installable packages)
│   ├── hospital-crm/
│   ├── kb-management/
│   ├── python-example/
│   └── test-app/
├── agents/                     # Agent template directories
│   ├── __test-bot__/
│   └── web-bot/
├── tests/                      # Backend unit + integration tests (~90 files)
│   ├── orchestrator/           # Orchestrator subsystem tests (16 files)
│   ├── api-integration/        # API integration tests
│   └── *.test.ts               # Per-module test files
├── docs/                       # Design docs, ADRs, specs
│   ├── specs/                  # Architecture specs and design docs
│   ├── adr/                    # Architecture Decision Records
│   ├── guides/                 # Operations guides
│   └── archive/                # Historical documents
├── .claude/                    # Claude Code skills
├── .githooks/                  # Git hooks
├── justfile                    # Task runner (just check / just pre-pr)
├── server.just                 # Server-specific just commands
├── web.just                    # Frontend-specific just commands
├── config.json                 # Runtime configuration (bots, claude, web)
└── package.json                # Node.js project manifest
```

## Directory Purposes

**`src/` (Backend):**
- Purpose: All backend TypeScript source code
- Contains: 50+ modules covering channels, agents, orchestration, routing, persistence
- Key files: `index.ts` (main entry), `agent.ts` (LLM session), `bot.ts` (routing), `web.ts` (HTTP server)
- Conventions: One primary export per file, named exports, class-based modules with dependency injection

**`src/orchestrator/` (Orchestrator Subsystem):**
- Purpose: Self-contained multi-agent orchestration with its own CLAUDE.md
- Contains: 20+ modules for employee management, handoff, contracts, routing, write locks
- Key files: `orchestrator-runner.ts` (external entry), `employee-api.ts` (admin API entry), `handoff-engine.ts` (core loop)
- Boundary: External modules MUST use `orchestrator-runner.ts` or `employee-api.ts` only

**`src/routes/` (Admin API Routes):**
- Purpose: Hono route registration modules, each file registers routes on the app
- Contains: 12 route files organized by domain
- Key files: `admin-config.ts`, `admin-apps.ts`, `admin-tenants.ts`, `enterprise-people.ts`, `templates.ts`
- Pattern: Each file exports a `registerXxxRoutes(app: Hono, deps)` function

**`src/prompts/` (Prompt Templates):**
- Purpose: Prompt templates for agent generation, optimization, and director routing
- Contains: `templates/` (agent-generation, agent-optimize, director) and `snippets/`
- Key files: `loader.ts` (template loading), `index.ts` (exports)

**`web/src/` (Frontend):**
- Purpose: React SPA for admin dashboard, chat, employee management
- Contains: Pages, components, stores, hooks, lib, types, styles
- Key files: `App.tsx` (router), `stores/chat.ts` (state), `lib/api.ts` (API client)
- Pattern: Container/presentational split, single Zustand store, centralized API client

**`web/src/pages/` (Frontend Pages):**
- Purpose: One file per page route, each is a self-contained page component
- Contains: 18 page files + subdirectories for complex pages (dashboard/, stats/)
- Key files: `Chat.tsx`, `Employees.tsx`, `EmployeeNetwork.tsx`, `Dashboard.tsx`, `Onboarding.tsx`
- Pattern: Pages import from `components/` and `lib/`, never directly fetch APIs

**`web/src/components/` (Shared Components):**
- Purpose: Reusable UI components organized by feature area
- Contains: Subdirectories `chat/`, `skill-marketplace/`, `demo/` plus standalone components
- Key files: `Layout.tsx` (app shell), `chat/ChatView.tsx`, `chat/MessageBubble.tsx`
- Pattern: Feature-organized subdirectories, not file-type split

**`corp/` (Tenant Data):**
- Purpose: Multi-tenant filesystem storage for employees, apps, roles, knowledge
- Contains: One subdirectory per tenant (e.g., `acme/`)
- Structure per tenant: `employees/*.yaml`, `agents/{agent-id}/`, `apps/{app-name}/`, `roles.json`, `people.json`
- Convention: All tenant path resolution uses `getTenantDir()` or `corp-dir.ts`

**`tests/` (Backend Tests):**
- Purpose: Unit and integration tests for all backend modules
- Contains: ~90 test files, co-located in `tests/` (not alongside source)
- Pattern: `{module-name}.test.ts` for unit, `integration-{feature}.test.ts` for integration
- Subdirectory: `tests/orchestrator/` mirrors `src/orchestrator/` structure

**`web/e2e/` (E2E Tests):**
- Purpose: Playwright end-to-end tests organized by user story
- Contains: 22 story directories (story-a through story-z)
- Pattern: `story-{letter}-{feature}/` with test files and optional screenshots
- Key files: `global-setup.ts`, `helpers.ts`

## Key File Locations

**Entry Points:**
- `src/index.ts`: Backend main entry -- bootstraps all subsystems
- `src/web.ts`: Hono HTTP server + route registration + static file serving
- `web/src/main.tsx`: Frontend React entry point
- `web/src/App.tsx`: Frontend router and data initialization

**Configuration:**
- `config.json`: Runtime config (bots, claude settings, web port, data dir)
- `src/config.ts`: Zod schema for config validation, env var expansion
- `corp/{tenant}/roles.json`: Per-tenant RBAC definitions
- `corp/{tenant}/people.json`: Enterprise people bindings

**Core Logic:**
- `src/agent.ts`: ClaudeAgent -- LLM session management via Claude Agent SDK
- `src/bot.ts`: BotManager -- message routing, dedup, session tracking
- `src/channel.ts`: ChannelAdapter interface (unified IM abstraction)
- `src/feishu.ts`: Feishu channel implementation (815 lines)
- `src/dingtalk.ts`: DingTalk channel implementation (1008 lines)
- `src/store.ts`: MessageStore -- SQLite message persistence
- `src/bus.ts`: MessageBus -- in-process pub/sub + rolling buffer
- `src/entry-router.ts`: Enterprise entry agent resolution + slash commands
- `src/enterprise-people.ts`: People store (binding users to employees)
- `src/auth-gate.ts`: RBAC deny-by-default authorization
- `src/scheduler.ts`: TaskScheduler -- cron/interval/once/event scheduling
- `src/mcp-tools.ts`: MCP tool definitions (handoff, memory, knowledge, etc.)
- `src/knowledge.ts`: Knowledge search via OpenViking integration
- `src/memory.ts`: Per-bot markdown memory files
- `src/logger.ts`: Pino logger (silent in test, pretty in dev, JSON in prod)
- `src/workdir.ts`: Workdir initialization and app management
- `src/tool-registry.ts`: Tool discovery from tenant app manifests

**Orchestrator Core:**
- `src/orchestrator/orchestrator-runner.ts`: External entry point for orchestration
- `src/orchestrator/employee-api.ts`: External entry point for admin API routes
- `src/orchestrator/handoff-engine.ts`: DynamicHandoffOrchestrator -- core handoff loop
- `src/orchestrator/employee-colony.ts`: EmployeeManager -- agent registry and session management
- `src/orchestrator/employee-loader.ts`: YAML loader with hot-reload delta detection
- `src/orchestrator/employee-schema.ts`: Zod schema for employee YAML validation
- `src/orchestrator/director-router.ts`: Keyword + LLM two-tier routing
- `src/orchestrator/contract-store.ts`: SQLite contract persistence
- `src/orchestrator/skill-bridge.ts`: Tool-to-MCP bridge with write-lock check
- `src/orchestrator/event-bridge.ts`: Domain event to agent execution bridge

**Frontend Core:**
- `web/src/lib/api.ts`: Centralized API client (674 lines)
- `web/src/stores/chat.ts`: Zustand store -- messages, streaming, workdirs, tenants
- `web/src/hooks/useWebSocket.ts`: WebSocket connection with auto-reconnect
- `web/src/components/Layout.tsx`: App shell with navigation
- `web/src/lib/auth.ts`: Token-based auth utilities

**Testing:**
- `tests/`: Backend tests (run from project root: `npx vitest run`)
- `web/e2e/`: Playwright E2E tests (run from web/: `npx playwright test`)
- `web/src/**/*.test.tsx`: Frontend unit tests (run from web/: `npx vitest run`)

## Naming Conventions

**Files:**
- Backend modules: kebab-case (`enterprise-routing.ts`, `skill-bridge.ts`, `auth-gate.ts`)
- Backend classes: PascalCase in kebab-case files (`ClaudeAgent` in `agent.ts`, `BotManager` in `bot.ts`)
- Frontend pages: PascalCase (`Chat.tsx`, `EmployeeNetwork.tsx`, `PeopleBinding.tsx`)
- Frontend components: PascalCase in subdirectories (`chat/ChatView.tsx`, `chat/MessageBubble.tsx`)
- Test files: `{module}.test.ts` for backend, `{Component}.test.tsx` for frontend
- Integration tests: `integration-{feature}.test.ts`
- Route files: `admin-{domain}.ts`, `{domain}.ts`
- Config files: lowercase (`config.json`, `justfile`, `server.just`, `web.just`)

**Directories:**
- Backend: kebab-case (`orchestrator/`, `routes/`, `prompts/`, `feishu-cards/`)
- Frontend: lowercase (`pages/`, `components/`, `stores/`, `hooks/`, `lib/`)
- Component subdirs: lowercase feature name (`chat/`, `skill-marketplace/`, `demo/`)
- Tenant data: `{tenant-name}/` (e.g., `acme/`)
- E2E stories: `story-{letter}-{feature}/`

**Exports:**
- Named exports only (no default exports)
- One primary class/function per file (with supporting types)
- Route files export `registerXxxRoutes()` function

## Where to Add New Code

**New Backend Module:**
- Primary code: `src/{module-name}.ts`
- Tests: `tests/{module-name}.test.ts`
- Register in: `src/index.ts` (if needed in bootstrap) or `src/web.ts` (if route-related)

**New API Route:**
- Route file: `src/routes/{domain}.ts` (export `registerXxxRoutes(app, deps)`)
- Register in: `src/web.ts` (import and call registration function)
- Test: `tests/{domain}.test.ts` or `tests/api-integration/{domain}.test.ts`

**New Employee (Digital Worker):**
- Definition YAML: `corp/{tenant}/employees/{employee-id}.yaml`
- Agent workdir: `corp/{tenant}/agents/{employee-id}/`
- Schema: Must conform to `employeeDefinitionSchema` in `src/orchestrator/employee-schema.ts`

**New Frontend Page:**
- Page component: `web/src/pages/{PageName}.tsx`
- Add route in: `web/src/App.tsx`
- Add nav link in: `web/src/components/Layout.tsx`
- Test: `web/src/pages/{PageName}.test.tsx`

**New Frontend Component:**
- Shared component: `web/src/components/{component-name}.tsx`
- Feature-scoped: `web/src/components/{feature}/{ComponentName}.tsx`
- Test: `web/src/components/{ComponentName}.test.tsx`

**New Channel Adapter (IM Platform):**
- Implementation: `src/{platform}.ts` (implements `ChannelAdapter` interface)
- Register in: `createChannel()` in `src/index.ts`
- Add to `BotSchema` channel enum in `src/config.ts`

**New Orchestrator Module:**
- Module: `src/orchestrator/{module-name}.ts`
- External API (if needed): Add to `orchestrator-runner.ts` or `employee-api.ts`
- Test: `tests/orchestrator/{module-name}.test.ts`
- **Never expose internal modules directly to outside `src/orchestrator/`**

**New Tenant:**
- Directory: `corp/{tenant-name}/`
- Minimum: `app.json` file (validated by `appJsonSchema`)
- Optional: `roles.json`, `employees/`, `apps/`, `knowledge/`

**New Industry Template:**
- Directory: `corp/templates/industries/{industry}/`
- Required: `template.json`, `roles.json`, `employees/`

**New Test (Backend):**
- Unit test: `tests/{module-name}.test.ts`
- Integration test: `tests/integration-{feature}.test.ts`
- Run: `cd happycompany && npx vitest run`

**New E2E Test:**
- Story directory: `web/e2e/story-{letter}-{feature}/`
- Test file: `web/e2e/story-{letter}-{feature}/{test-name}.spec.ts`
- Run: `cd happycompany/web && npx playwright test`

## Special Directories

**`corp/` (Tenant Data):**
- Purpose: Multi-tenant filesystem data store
- Generated: Partially (agents/ workdirs created at runtime)
- Committed: Yes (employee YAMLs, roles.json, app configs tracked in git)
- Contains runtime uploads and agent session data (in agent workdirs)

**`web/dist/` (Built Frontend):**
- Purpose: Production build output served by backend
- Generated: Yes (`npm run build` in web/)
- Committed: Typically not (build artifact)
- Must rebuild after frontend changes to see on port 3100

**`data/` (Runtime Data):**
- Purpose: Messages DB, contracts DB, memory files, encryption key
- Generated: Yes (created at runtime)
- Committed: No
- Location: Configured by `dataDir` in `config.json` (default: `data/`)

**`agents/` (Agent Templates):**
- Purpose: Template agent directories for creating new agent instances
- Generated: Partially
- Committed: Yes

**`apps/` (Global Apps):**
- Purpose: Installable tenant apps with CLI tools and tool manifests
- Structure: `apps/{app-name}/v1.0/bin/` for entry points, may include Python source
- Committed: Yes

**`.claude/skills/` (Claude Code Skills):**
- Purpose: Project-level Claude Code skills for development workflows
- Committed: Yes

**`docs/` (Documentation):**
- Purpose: Architecture specs, ADRs, operations guides
- Structure: `specs/`, `adr/`, `guides/`, `archive/`
- Committed: Yes

---

*Structure analysis: 2026-05-22*
