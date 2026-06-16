# External Integrations

**Analysis Date:** 2026-05-22

## APIs & External Services

**AI/LLM:**
- Anthropic Claude API - Core AI inference for all agent interactions
  - SDK: `@anthropic-ai/claude-agent-sdk` (wraps Claude Code subprocess)
  - Auth: `ANTHROPIC_API_KEY` env var or per-bot `apiKey` in `config.json`
  - Per-bot overrides: `baseUrl`, `authToken` fields in bot config
  - Models used: `claude-sonnet-4-6` (main), `claude-haiku-4-5` (director routing)
  - Implementation: `src/agent.ts` (`ClaudeAgent.respond()`)

**IM Platforms:**
- Feishu (Lark) - Enterprise messaging channel
  - SDK: `@larksuiteoapi/node-sdk` ^1.58.0
  - Auth: appId/appSecret from `bot.credentials` in `config.json`
  - Features: WebSocket events, streaming cards, card actions, file download, image upload
  - Implementation: `src/feishu.ts` (`FeishuChannel` class)

- DingTalk - Enterprise messaging channel
  - SDK: `dingtalk-stream` ^2.1.6-beta.1 (dynamically imported, stub at `src/dingtalk-stream-stub.ts`)
  - Auth: client_id/client_secret from `bot.credentials` in `config.json`
  - Features: Stream mode, token caching, streaming cards, file handling, reply detection
  - API base: `https://api.dingtalk.com`
  - Implementation: `src/dingtalk.ts` (`DingTalkChannel` class)

**Knowledge/Search:**
- OpenViking - Vector search service for knowledge retrieval
  - Connection: `OPENVIKING_URL` env var (defaults to `http://127.0.0.1:1933`)
  - API: `POST /api/collections/{collection}/search` with hybrid mode
  - Fallback: Markdown file search via `src/knowledge-router.ts` when service unavailable
  - Implementation: `src/knowledge.ts` (`buildKnowledgeMcpServer`, `searchOpenViking`)

**Python App Servers:**
- Tenant apps run as Python child processes managed by `src/app-server.ts`
  - Communication: JSON-RPC over stdio (stdin/stdout)
  - Python path: configurable per-app in `app.json` (`python` field)
  - Lifecycle: spawn on demand, auto-restart on crash, managed by `AppServerMgr`

## Data Storage

**Databases:**
- SQLite (via `better-sqlite3`)
  - Message store: `{dataDir}/messages.db` - Chat messages, daily summaries, scheduled tasks (`src/store.ts`)
  - Contract store: `{dataDir}/contracts.db` - Multi-agent contracts, routing decisions (`src/orchestrator/contract-store.ts`)
  - Schema auto-created on startup with CREATE TABLE IF NOT EXISTS
  - No ORM, raw SQL with prepared statements

**File Storage:**
- Local filesystem - Primary data store
  - `corp/{tenant}/` - Tenant configs, employee YAML definitions, roles.json, apps
  - `data/` - Runtime data (messages.db, contracts.db, config/, encryption.key)
  - `{agentDir}/.session-*.json` - Per-chat Claude session state
  - `agents/{bot-name}/` - Bot persona files (CLAUDE.md, knowledge/)

**Caching:**
- In-memory only (no Redis or external cache)
  - `DedupCache` (`src/dedup.ts`) - Message deduplication
  - `InMemoryStatsStore` (`src/orchestrator/stats.ts`) - Agent statistics
  - `InMemoryChainStore` (`src/orchestrator/contract-chain.ts`) - Contract chain tracking
  - DingTalk token cache - Access token with TTL (`src/dingtalk.ts`)

## Authentication & Identity

**Auth Provider:**
- Custom Bearer token authentication
  - Implementation: Admin API middleware in `src/web.ts` (lines 97-109)
  - Token: `adminToken` field in `config.json` (optional, dev mode when absent)
  - Protected routes: `/api/admin/*`, `/api/employees/*`, `/api/orchestration/*`, `/api/workflows/*`

**Authorization:**
- RBAC via `AuthGate` (`src/auth-gate.ts`)
  - deny-by-default policy
  - Roles loaded from `corp/{tenant}/roles.json`
  - Controls tool/skill visibility per user per tenant
  - `buildEnterpriseCanUseTool` (`src/enterprise-tool-policy.ts`) - SDK permission hook

**Credential Management:**
- AES-256-GCM encryption for bot credentials (`src/crypto.ts`)
  - Encryption key: `{dataDir}/config/encryption.key`
  - Plaintext credentials detected and warned at startup
  - `enc:` prefix identifies encrypted values

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, DataDog, etc.)

**Logs:**
- Pino structured logging (`src/logger.ts`)
  - Dev: `pino-pretty` with colorized output, `SYS:HH:MM:ss.l` timestamps
  - Prod: JSON output to stdout
  - Test: silent (level=silent when VITEST env set)
  - Level controlled by `LOG_LEVEL` env var (defaults to `info`)

## CI/CD & Deployment

**Hosting:**
- Self-hosted Node.js process
  - PM2 recommended per `docs/guides/operations.md`
  - Single process serves API + static frontend

**CI Pipeline:**
- None detected (no `.github/workflows/`, no CI config files)
- Manual checks via `just` task runner:
  - `just check` - Fast domain-aware checks (server or web based on changed files)
  - `just pre-pr` - Full push-level checks (tsc + build + vitest + E2E)

## Environment Configuration

**Required env vars:**
- `ANTHROPIC_API_KEY` - Claude API key (also settable via `config.json` claude.apiKey)
- `ANTHROPIC_BASE_URL` - Optional, for API proxy/enterprise gateway
- `ANTHROPIC_AUTH_TOKEN` - Optional, alternative auth method
- `ANTHROPIC_MODEL` - Optional, override default model

**Optional env vars:**
- `OPENVIKING_URL` - Knowledge vector search service URL (default: `http://127.0.0.1:1933`)
- `LOG_LEVEL` - Pino log level (default: `info`)
- `NODE_ENV` - Environment mode (`production` changes logging output)
- `DINGTALK_STREAM_ALLOW_STUB` - Allow DingTalk SDK stub in dev

**Secrets location:**
- `config.json` - Bot credentials (encrypted with AES-256-GCM)
- `{dataDir}/config/encryption.key` - Master encryption key for credentials
- `process.env` - Anthropic API credentials injected at startup

## Webhooks & Callbacks

**Incoming:**
- WebSocket `/api/ws` - Real-time bidirectional communication with frontend (`src/ws.ts`)
  - Message types: snapshot, new_message, agent_reply_sent, config_reloaded, chat_cleared
  - Supports abort control for in-flight agent requests

**Outgoing:**
- Feishu: Message send, streaming card update, image upload, reaction APIs
- DingTalk: Message send, streaming card, file download/upload via REST APIs
- Anthropic API: All LLM calls via Claude Agent SDK

## MCP (Model Context Protocol) Servers

**Platform MCP:**
- Built programmatically via `src/mcp-tools.ts` (`buildPlatformMcpServer`)
  - Tools: `send_message`, `schedule_task`, `list_tasks`, `cancel_task`, `save_memory`, `recall_memory`
  - Injected into every agent session

**Tenant MCP:**
- Built via `src/mcp-tools.ts` (`buildTenantMcpServer`)
  - Dynamically loads tool definitions from `corp/{tenant}/apps/{app}/tools.json`
  - Proxies tool calls to running Python app servers

**Knowledge MCP:**
- Built via `src/knowledge.ts` (`buildKnowledgeMcpServer`)
  - Tools: `search_knowledge` (vector + markdown hybrid)
  - Connects to OpenViking service

**Handoff MCP:**
- Built via `src/mcp-tools.ts` (`buildHandoffToolDef`)
  - Tool: `handoff` - Multi-agent task transfer in orchestration

---

*Integration audit: 2026-05-22*
