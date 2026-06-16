# Architecture

**Analysis Date:** 2026-05-22

## Pattern Overview

**Overall:** Modular monolith with channel-adapter pattern, multi-agent orchestration, and tenant-isolated data.

**Key Characteristics:**
- Channel Adapter pattern: IM platforms (Feishu, DingTalk, Web) behind a unified `ChannelAdapter` interface
- Agent-per-bot: each bot config gets its own `ClaudeAgent` instance with isolated sessions
- Orchestrator subsystem: self-contained multi-agent handoff engine with contract lifecycle
- Multi-tenant via filesystem: `corp/{tenant}/` directories isolate employees, roles, apps, and knowledge
- Hot-reload: `config.json` and employee YAML files are watched for live updates without restart
- In-process pub/sub (`MessageBus`) bridges all subsystems and feeds WebSocket live events to the frontend

## Layers

**HTTP/API Layer:**
- Purpose: Expose REST endpoints for admin UI, business monitoring, and WebSocket chat
- Location: `src/web.ts`, `src/routes/`, `src/business-api.ts`
- Contains: Hono route registrations, request validation, response shaping
- Depends on: `BotManager`, `EmployeeManager`, `ContractStore`, `StatsStore`, `MessageBus`
- Used by: Frontend SPA (port 8888 dev, 3100 production)

**Bot Management Layer:**
- Purpose: Route incoming messages to the correct agent, deduplicate, track sessions
- Location: `src/bot.ts`
- Contains: `BotManager` class, `AgentFactory` interface, `RespondOptions` type
- Depends on: `ChannelAdapter`, `ClaudeAgent`, `MessageStore`, `MessageBus`, `DedupCache`
- Used by: HTTP layer (routes), WebSocket layer

**Agent Layer:**
- Purpose: Own the LLM session lifecycle, manage conversation context and MCP tool injection
- Location: `src/agent.ts`
- Contains: `ClaudeAgent` class, `AgentOptions`, `RespondOptions` interfaces
- Depends on: `@anthropic-ai/claude-agent-sdk`, filesystem for sessions
- Used by: `BotManager`, `EmployeeManager` (orchestrator)

**Channel Layer:**
- Purpose: Abstract IM platform differences behind a unified interface
- Location: `src/channel.ts` (interface), `src/feishu.ts`, `src/dingtalk.ts`
- Contains: `ChannelAdapter` interface, `StreamingHandle`, `CardAction`, `DownloadedFile`
- Depends on: Platform SDKs (`@larksuiteoapi/node-sdk`, DingTalk stream client)
- Used by: `BotManager`

**Orchestrator Subsystem:**
- Purpose: Multi-agent handoff, contract lifecycle, director routing, write locks
- Location: `src/orchestrator/` (self-contained with its own CLAUDE.md)
- Contains: 20+ modules for employee loading, handoff engine, contract store, skill bridge
- Depends on: `ClaudeAgent`, `MessageBus`, `ContractStore` (SQLite), filesystem
- Used by: External modules access only through `orchestrator-runner.ts` and `employee-api.ts`
- **Internal boundary:** Never import orchestrator internals from outside

**Enterprise Routing Layer:**
- Purpose: Route messages from human users to their bound digital employee
- Location: `src/entry-router.ts`, `src/enterprise-routing.ts`, `src/enterprise-people.ts`
- Contains: `resolveEnterpriseEntryAgent()`, `parseSlashCommand()`, `EnterprisePeopleStore`
- Depends on: `EmployeeManager`, filesystem (people.json per tenant)
- Used by: `agentFactory.respond()` in `src/index.ts`

**Data/Infrastructure Layer:**
- Purpose: Message persistence, config management, caching, encryption
- Location: `src/store.ts` (SQLite), `src/config.ts` (Zod-validated), `src/dedup.ts`, `src/crypto.ts`, `src/memory.ts`
- Contains: `MessageStore`, `Config` type, `DedupCache`, `MemoryManager`
- Depends on: `better-sqlite3`, filesystem
- Used by: All upper layers

**Frontend SPA Layer:**
- Purpose: Admin dashboard, chat interface, employee management, monitoring
- Location: `web/src/`
- Contains: React pages (18), Zustand store (1), WebSocket hook, API client
- Depends on: Backend API (port 3100), WebSocket (`/api/ws`)
- Used by: End users (operators, admins)

## Data Flow

**Incoming IM Message (Feishu/DingTalk):**

1. Platform webhook delivers event to `FeishuChannel` / `DingTalkChannel`
2. Channel normalizes to `NormalizedMessage`, calls `onMessage` handler
3. `BotManager` receives message, checks dedup cache, resolves bot config
4. `BotManager` calls `agentFactory.respond(prompt, chatId, botName, opts)`
5. `agentFactory` (in `src/index.ts`) checks routing mode:
   - `employee-director` mode: resolves personal employee binding via `EnterprisePeopleStore`
   - Direct mode: creates/gets `ClaudeAgent`, injects MCP servers and tool permissions
6. Agent calls Claude API, streams response back
7. Response sent to channel via `channel.send()` or `channel.sendStreaming()`
8. Message persisted in `MessageStore`, event published to `MessageBus`

**Multi-Agent Handoff:**

1. User sends message to a bot with `allowedTargets` (digital employee network)
2. `agentFactory` delegates to `PMOOrchestratorRunner.respond()`
3. Runner builds `DynamicHandoffOrchestrator` with all employee protocols
4. Entry agent executes, may call `handoff` tool to transfer work
5. `DynamicHandoffOrchestrator` detects handoff via `onToolStart` callback
6. Director router (keyword + optional LLM) selects target agent
7. Contract created in `ContractStore` (SQLite), events published to bus
8. Target agent executes, may handoff again or signal done
9. Loop continues until max iterations or final response
10. Orchestrator returns final response through the chain

**WebSocket Chat (Web UI):**

1. Frontend opens WebSocket to `/api/ws`
2. `attachWebSocket()` sends bus snapshot, subscribes to live events
3. User sends message via WS
4. Server creates `AbortController`, calls `agentFactory.respond()`
5. Streaming text deltas, tool status updates pushed to WS client
6. Frontend renders streaming display with tool activity cards

**State Management:**
- Backend: In-process state (Maps, Sets) + SQLite for messages and contracts
- Frontend: Single Zustand store (`stores/chat.ts`) for messages, streaming state, tenant/workdir selection
- Real-time: `MessageBus` (in-process pub/sub) bridges backend events to WebSocket clients

## Key Abstractions

**ChannelAdapter:**
- Purpose: Abstract IM platform differences behind a unified interface
- Interface: `src/channel.ts`
- Implementations: `src/feishu.ts` (FeishuChannel), `src/dingtalk.ts` (DingTalkChannel), no-op for web
- Pattern: Strategy pattern -- each channel implements start/stop/send/sendStreaming/react/downloadFile
- Adding a new channel: Implement `ChannelAdapter`, add case in `createChannel()` in `src/index.ts`

**AgentFactory:**
- Purpose: Decouple bot management from agent creation and routing logic
- Interface: `src/bot.ts` (`AgentFactory` interface with respond/clearSession/clearAllSessions/listSessions)
- Implementation: Inline in `src/index.ts` as a plain object (not a class)
- Pattern: Factory + routing -- creates agents on demand, routes to orchestrator when needed
- Key routing logic: enterprise-director mode, employee handoff, direct bot

**AgentProtocol:**
- Purpose: Unified interface for orchestrator to interact with any agent
- Interface: `src/orchestrator/types.ts` (name, execute method returning `AgentResponse`)
- Implementation: `AgentAdapter` in `src/orchestrator/employee-colony.ts`
- Pattern: Adapter -- wraps `ClaudeAgent` to extract handoff signals from tool callbacks

**MessageBus:**
- Purpose: In-process event bus for pub/sub, rolling buffer, agent inbox routing
- Implementation: `src/bus.ts` -- synchronous listeners, rolling buffer (200 events max), domain event subscriptions
- Pattern: Observer + message queue hybrid
- Consumers: WebSocket layer (live feed), EventBridge (domain events to agent triggers), stats collector

**EmployeeDefinition (YAML schema):**
- Purpose: Declarative digital employee configuration loaded from `corp/{tenant}/employees/*.yaml`
- Schema: `src/orchestrator/employee-schema.ts` (Zod validated)
- Loader: `src/orchestrator/employee-loader.ts` scans all tenants, supports hot reload with delta detection
- Pattern: Configuration-as-code -- employees defined declaratively, loaded at runtime

## Entry Points

**Backend Main (`src/index.ts`):**
- Location: `src/index.ts`
- Triggers: `npm run dev` / `node dist/index.js config.json`
- Responsibilities: Bootstrap all subsystems (config, channels, agents, orchestrator, scheduler, web server), wire dependencies, set up hot-reload watchers, register shutdown handlers

**Web Server (`src/web.ts`):**
- Location: `src/web.ts`
- Triggers: Called by `main()` via `startWebServer(deps)`
- Responsibilities: Create Hono app, register all route modules, serve static frontend files, attach WebSocket

**Frontend Entry (`web/src/main.tsx`):**
- Location: `web/src/main.tsx`
- Triggers: Vite dev server (8888) or built assets served by backend (3100)
- Responsibilities: Mount React app, render `<App />` with router

**Frontend App (`web/src/App.tsx`):**
- Location: `web/src/App.tsx`
- Triggers: React router on page load
- Responsibilities: Check setup status, load tenant/workdir data, define all routes with `<Layout>` wrapper and auth guards

## Error Handling

**Strategy:** Layered error handling with explicit catch blocks at every boundary.

**Patterns:**
- Route handlers return structured error responses via Hono context
- Agent errors: caught in `agentFactory.respond()`, logged via Pino, returned as user-facing messages
- Orchestrator errors: typed error classes (`SecurityError`, `AgentNotFoundError`, `MaxIterationsError`, `LoopDetectionError`) in `src/orchestrator/errors.ts`
- Channel errors: caught and logged, never crash the process
- Config reload errors: logged but old config kept (graceful degradation)
- Validation: Zod schemas at all system boundaries (`config.ts`, `schemas.ts`, `employee-schema.ts`, `tool-schemas.ts`)

## Cross-Cutting Concerns

**Logging:** Pino (`src/logger.ts`) -- silent in test, pretty-print in dev, JSON in production. Zero `console.log` policy enforced.

**Validation:** Zod schemas for all external input -- config.json, webhook payloads, employee YAML, tool manifests, API request bodies.

**Authentication:**
- Admin API: token-based via `adminToken` in config, checked by `AdminAuthGuard` component and route middleware
- Enterprise RBAC: `AuthGate` (`src/auth-gate.ts`) deny-by-default, roles defined per tenant in `roles.json`
- Tool permissions: `canUseTool` hook injected per-request, checks user role against allowed skills

**Tenant Isolation:**
- Each tenant lives in `corp/{tenantName}/` with its own employees, apps, roles, knowledge
- `resolveCorpDir()` (`src/corp-dir.ts`) locates the corp directory
- All path resolution goes through tenant-aware functions, never hardcoded

**Real-time Updates:**
- `MessageBus` publishes events to WebSocket clients
- Frontend `useWebSocket` hook maintains connection with auto-reconnect (3s)
- Event types: message_received, agent_thinking_start, agent_reply_sent, orchestration_handoff, contract lifecycle events

**Hot Reload:**
- `config.json` changes trigger `handleConfigChange()` with debounced reload
- Employee YAML changes trigger `handleAppChange()` with delta detection (added/removed/changed)
- File watching via `node:fs` `watchFile` and `watch` (recursive)

---

*Architecture analysis: 2026-05-22*
