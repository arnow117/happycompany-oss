# Coding Conventions

**Analysis Date:** 2026-05-22

## Naming Patterns

**Files:**
- Backend source: kebab-case (`bot.ts`, `auth-gate.ts`, `enterprise-routing.ts`, `workdir-scanner.ts`)
- Backend tests: kebab-case matching source (`bot.test.ts`, `auth-gate.test.ts`)
- Frontend components: PascalCase (`Layout.tsx`, `OnboardingBanner.tsx`, `ChatView.tsx`)
- Frontend pages: PascalCase (`Chat.tsx`, `Login.tsx`, `EmployeeNetwork.tsx`)
- Frontend tests: PascalCase matching component (`Login.test.tsx`, `Chat.test.tsx`)
- Route registrations: kebab-case (`public-routes.ts`, `admin-config.ts`, `bot-bindings.ts`)
- Orchestrator modules: kebab-case (`employee-loader.ts`, `handoff-engine.ts`, `contract-store.ts`)
- E2E tests: kebab-case with story prefix (`story-f-login/story-f.spec.ts`)

**Functions:**
- camelCase: `createChannel()`, `resolveTenant()`, `sanitizeEnv()`
- Factory helpers prefixed with `create` or `make`: `createMockChannel()`, `makeBotConfig()`
- Boolean-returning functions prefixed with `is`/`has`: `isGroupChat()`, `isEnvVarUnset()`, `isValidPath()`

**Variables:**
- camelCase: `chatId`, `botConfig`, `tenantName`
- Constants: UPPER_SNAKE_CASE: `MAX_CUSTOM_ENV_ENTRIES`, `DANGEROUS_ENV_VARS`, `BASE`
- Private class fields: `private readonly` prefix, no underscore: `private readonly store`, `private bots`

**Types:**
- Interfaces: PascalCase (`BotConfig`, `NormalizedMessage`, `ChannelAdapter`)
- Type aliases: PascalCase (`MessageSource`, `BusEventType`)
- Zod schema types: inferred with `z.infer<typeof Schema>` and exported
- Suffix convention: `*Deps` for dependency injection interfaces (`WebDeps`, `BotManagerDeps`, `PublicRoutesDeps`)
- Suffix convention: `*Input` for raw/zod-input types (`FeishuMessageEventInput`)

**Classes:**
- PascalCase: `BotManager`, `DedupCache`, `MessageBus`, `TenantMgr`, `AuthGate`
- Constructor params passed as typed `Deps` interface, not positional args

## Code Style

**Formatting:**
- No project-level Prettier or ESLint config detected
- TypeScript strict mode enabled in `tsconfig.json` (`strict: true`)
- ESM modules: `"type": "module"` in `package.json`
- Import extensions: `.js` suffix required (`import { logger } from './logger.js'`)
- Target: ES2022, module: ESNext, moduleResolution: bundler

**Linting:**
- No ESLint or Biome config files present
- Convention enforced via CLAUDE.md prohibitions and code review
- `just check` runs `tsc --noEmit` for type checking
- Project has zero `any` types; convention is to use `unknown` with narrowing

**Key strict TypeScript rules:**
- No `any` types (project rule S3). Use `unknown` and narrow with type guards
- No `console.log` in production code. Use `logger` from `src/logger.ts` (Pino)
- All imports use `.js` extension for ESM compatibility

## Import Organization

**Order:**
1. External packages (`import { z } from 'zod'`, `import { Hono } from 'hono'`)
2. Node built-ins (`import fs from 'node:fs'`, `import { join } from 'node:path'`)
3. Internal modules with relative paths (`import { logger } from './logger.js'`)
4. Type-only imports at end of group (`import type { Config } from './config.js'`)

**Style:**
- Named imports preferred over namespace imports
- Type-only imports use `import type { ... }` syntax
- No barrel files or index re-exports in backend
- Orchestrator internal imports restricted: only `orchestrator-runner.ts` and `employee-api.ts` are public entry points

**Path Aliases:**
- None configured. All imports use relative paths with `.js` extensions

## Error Handling

**Patterns:**
- Zod `safeParse()` for validation at system boundaries, checking `result.success`:
  ```typescript
  const result = feishuMessageEventSchema.safeParse(rawData);
  if (result.success) { /* use result.data */ }
  ```
- Zod `.parse()` for config loading where failure should throw
- Logger captures errors with context objects:
  ```typescript
  logger.warn({ tenant: tenantName, err }, 'Failed to parse app.json');
  logger.info({ count: this.tenants.size }, 'TenantMgr scan complete');
  ```
- `try/catch` blocks around external I/O (JSON parsing, file reads)
- Error re-throwing with context: `throw new Error(`Unknown tenant: ${tenantName}`)`
- Test assertions on thrown errors: `expect(() => fn()).toThrow('message')`

**Boundary validation:**
- All webhook payloads validated with Zod schemas in `src/schemas.ts` before reaching business logic
- Environment variable sanitization in `src/env-guard.ts`
- Path traversal prevention in `src/workdir-scanner.ts` (`isValidPath()`)

## Logging

**Framework:** Pino (`src/logger.ts`)

**Patterns:**
- Structured logging with context objects: `logger.info({ count, names }, 'message')`
- Error logging: `logger.warn({ tenant, err }, 'description')`
- Test mode: logger silenced (`level: 'silent'`) when `VITEST` env is set
- Production: plain JSON; Development: `pino-pretty` with colorized output
- Zero `console.log` in codebase (project rule X4/S4)

**When to log:**
- Startup/shutdown events (`TenantMgr scan complete`)
- Config validation failures (`Failed to parse app.json`)
- Security-relevant events (`blocked dangerous env var`)
- NOT for routine business logic flow (keep logs actionable)

## Comments

**When to Comment:**
- Module-level JSDoc describing purpose, especially for security-sensitive modules (`src/env-guard.ts`, `src/schemas.ts`)
- Section dividers with `// ── Title ──` pattern (used extensively in `src/config.ts`, `src/schemas.ts`, test files)
- Inline comments for non-obvious business rules (chat ID prefix conventions in `isGroupChat()`)

**JSDoc/TSDoc:**
- Used on exported functions/classes when behavior is not obvious from name
- Example from `src/dedup.ts`:
  ```typescript
  /**
   * TTL-bounded LRU for message-id deduplication.
   * ...
   */
  export class DedupCache { ... }
  ```
- Not used on simple getters/setters or self-explanatory functions

## Function Design

**Size:** Typical 10-30 lines. Longer functions split into helpers. Files generally under 400 lines with two exceptions noted in CLAUDE.md (`dingtalk.ts` at 1008, `feishu.ts` at 815 -- flagged for refactoring).

**Parameters:**
- Dependency injection via typed `*Deps` interfaces passed to constructors
- Factory functions accept `Partial<T>` overrides: `makeBotConfig(overrides?: Partial<BotConfig>)`
- Route handlers receive Hono `Context` (`c`)

**Return Values:**
- Functions return typed objects, not tuples
- Validation returns discriminated unions (`{ success: true, data } | { success: false }`)
- Route handlers return `c.json({ ... })`

## Module Design

**Exports:**
- Named exports only (no default exports)
- Each file exports related types, schemas, and functions together
- Class modules export the class plus supporting interfaces

**Barrel Files:**
- Not used in backend. Each module imported directly by path
- Frontend has no barrel files either; imports reference specific files

**Dependency Injection:**
- Backend uses constructor injection via `*Deps` interfaces
- Classes receive dependencies in constructor: `new BotManager({ config, agentFactory, bus, store, dedup })`
- Routes receive `Hono` app instance + deps object: `registerPublicRoutes(app, deps)`
- Mutable shared state passed via `MutableRef<T>` wrapper: `configRef: MutableRef<Config>`

## Architecture Constraints (from CLAUDE.md)

- Dependency direction: `routes -> business-api -> core (bot, agent, store) -> channel`. Never import from routes into core.
- `orchestrator/` is self-contained. Access only through `orchestrator-runner.ts` and `employee-api.ts`.
- `ClaudeAgent` (`agent.ts`) owns the LLM session. No other module calls Anthropic API directly.
- `AuthGate` (`auth-gate.ts`) is deny-by-default. New tools require `roles.json` update, not code changes.
- Frontend API calls centralized in `web/src/lib/api.ts`. Never fetch directly from pages.
- Single Zustand store (`web/src/stores/chat.ts`). Extend, do not create new stores.
- Immutable state updates in Zustand: use spread operator, never mutate state directly.

## Immutable Data Patterns

**Backend:**
- Config updates create new objects: `result[name] = { ...bot, name }` in `botsWithNames()`
- Spread for credential encryption: `{ ...config, bots }` in `encryptConfigCredentials()`
- Zustand state updates use `set((s) => ({ ...s, field: value }))`

**Frontend:**
- Zustand mutations use callback form with spread:
  ```typescript
  set((s) => ({
    messages: [...s.messages, msg],
  }))
  ```
- Derived data computed with `useMemo`, never in Zustand selectors (prevents infinite re-renders)

---

*Convention analysis: 2026-05-22*
