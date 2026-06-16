# Technology Stack

**Analysis Date:** 2026-05-22

## Languages

**Primary:**
- TypeScript 5.9 - Entire backend (`src/`) and frontend (`web/src/`), strict mode enabled, ESM modules (`"type": "module"`)

**Secondary:**
- Python - Tenant app servers spawned as child processes via `src/app-server.ts`, communicates via JSON-RPC or CLI
- CSS - Design token system in `web/src/styles/tokens.css`, Tailwind CSS v4 for utility classes

## Runtime

**Environment:**
- Node.js >=20 (specified in `package.json` engines), v25.9.0 observed in dev
- ESM modules throughout (`"type": "module"` in both `package.json`)

**Package Manager:**
- npm 11.12.1
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Hono 4.12 - HTTP server framework for backend API (`src/web.ts`)
- React 19.2 - Frontend SPA (`web/src/`)
- Vite 6.4 - Frontend build tool + dev server with HMR (`web/vite.config.ts`)

**LLM/AI:**
- `@anthropic-ai/claude-agent-sdk` 0.2.126 - Primary AI runtime, wraps Claude Code subprocess with session management (`src/agent.ts`)

**Testing:**
- Vitest 4.1 - Unit/integration test runner for both backend and frontend
- Playwright 1.59 - E2E testing for frontend (`web/e2e/`)
- `@testing-library/react` 16.3 - Component testing
- `@vitest/coverage-v8` - Code coverage provider

**Build/Dev:**
- `tsx` 4.19 - TypeScript execution for `npm run dev` (backend)
- `tsc` 5.9 - Type checking (strict mode)
- Tailwind CSS 4.2 via `@tailwindcss/vite` plugin

## Key Dependencies

**Critical:**
- `@anthropic-ai/claude-agent-sdk` ^0.2.126 - Core AI agent runtime, provides `query()`, MCP server builder, streaming, session management
- `hono` ^4.12.15 - HTTP framework with CORS middleware, used for all API routes
- `@hono/node-server` ^2.0.0 - Node.js adapter for Hono
- `better-sqlite3` ^12.9.0 - Embedded SQLite for message store (`src/store.ts`) and contract persistence (`src/orchestrator/contract-store.ts`)
- `zod` ^4.0.0 - Schema validation for config, employee YAML, API inputs

**Infrastructure:**
- `ws` ^8.20.0 - WebSocket server for real-time frontend communication (`src/ws.ts`)
- `pino` ^9.5.0 + `pino-pretty` ^13.0.0 - Structured logging (zero console.log policy)
- `yaml` ^2.8.4 - YAML parsing for employee definitions in `corp/{tenant}/employees/`
- `cron-parser` ^5.5.0 - Cron expression parsing for task scheduler (`src/scheduler.ts`)

**Frontend UI:**
- `zustand` ^5.0.13 - Client state management (single store: `web/src/stores/chat.ts`)
- `react-router-dom` ^7.14.2 - SPA routing
- `@codemirror/*` (8 packages) - Code editor for skill/config editing
- `lucide-react` ^1.14.0 - Icon library
- `sonner` ^2.0.7 - Toast notifications
- `clsx` + `tailwind-merge` - Class name utilities
- `react-markdown` + `rehype-*` + `remark-*` - Markdown rendering pipeline
- `dompurify` + `rehype-sanitize` - HTML sanitization
- `@tanstack/react-virtual` ^3.13.24 - Virtualized lists
- `@dnd-kit/core` + `@dnd-kit/sortable` - Drag and drop

**Channel Integrations:**
- `@larksuiteoapi/node-sdk` ^1.58.0 - Feishu/Lark bot SDK (`src/feishu.ts`)
- `dingtalk-stream` ^2.1.6-beta.1 - DingTalk streaming SDK (`src/dingtalk.ts`, dynamically imported)

## Configuration

**Environment:**
- Config loaded from `config.json` (path passed as CLI arg, defaults to `config.json`)
- Environment variable expansion supported in config values: `$ANTHROPIC_API_KEY` resolves to `process.env.ANTHROPIC_API_KEY`
- Credential encryption: AES-256-GCM with key stored in `{dataDir}/config/encryption.key`
- Hot reload: `config.json` watched with `fs.watchFile`, bot changes applied without restart

**Key configs:**
- `config.json` - Bots, Claude API settings, web port, data directory, admin token
- `tsconfig.json` (root) - Backend TypeScript config, ES2022 target, ESNext modules
- `tsconfig.json` (web) - Frontend config, includes DOM types, excludes test files
- `vitest.config.ts` (root) - Backend test config, coverage thresholds (65% statements, 55% branches)
- `vitest.config.ts` (web) - Frontend test config, jsdom environment
- `web/vite.config.ts` - Dev server on port 8888, API proxy to localhost:3100
- `web/src/styles/tokens.css` - Design tokens (colors, spacing, typography, shadows, dark mode)

**Build:**
- Backend: `tsc` compiles `src/` to `dist/`
- Frontend: `vite build` outputs to `web/dist/`, served as static files by backend on port 3100

## Platform Requirements

**Development:**
- Node.js >=20
- npm
- `just` (task runner, `justfile` at project root)
- Anthropic API key (Claude Agent SDK)

**Production:**
- Single Node.js process serves both API (3100) and static frontend
- SQLite databases auto-created in `{dataDir}/` (messages.db, contracts.db)
- File system access required for `corp/{tenant}/` employee YAML configs
- Optional: Python runtime for tenant app servers
- Optional: OpenViking vector search service (defaults to `http://127.0.0.1:1933`)

---

*Stack analysis: 2026-05-22*
