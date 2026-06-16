# src/orchestrator/ — Employee Orchestration Subsystem

> Inherits from /CLAUDE.md and /src/CLAUDE.md. Rules here ADD, never contradict.

## Module Boundaries

```
External entry points (other modules use these):
  ├── orchestrator-runner.ts   ← scheduler/chat bridge
  └── employee-api.ts          ← admin API routes

Internal modules (never import from outside orchestrator/):
  ├── employee-loader.ts       YAML → LoadedEmployee + hot reload
  ├── employee-colony.ts       Agent registry, session management, handoff execution
  ├── employee-generator.ts    NL → YAML agent builder (Claude-powered)
  ├── handoff-engine.ts        Multi-agent handoff loop + contract lifecycle
  ├── director-router.ts       Keyword + LLM two-tier routing
  ├── contract-store.ts        SQLite contract persistence
  ├── contract-chain.ts        Contract tree traversal
  ├── skill-bridge.ts          Tool → MCP bridge + write-lock check
  ├── employee-schema.ts       Zod validation for employee YAML
  └── context.ts / config.ts / types.ts / errors.ts
```

## Prohibitions

| # | 禁止 | Rationale |
|---|------|-----------|
| O1 | 外部模块不直接 import orchestrator 内部文件 | 只用 runner 和 api 入口。内部模块变更不影响外部 |
| O2 | 不在 colony 外直接创建 ClaudeAgent 实例 | colony 管理所有 agent session，确保生命周期一致 |
| O3 | 不跳过 contract-store 直接写合约 | 所有合约必须经过 contract-store 保证持久化和查询一致性 |

## Self-Check Triggers

- **"新建一个 orchestrator 入口文件"** → 确认 runner 和 api 不够用才加新入口
- **"直接操作 SQLite 写合约"** → 走 contract-store
- **"在 handoff-engine 里硬编码目标 agent"** → 用 director-router 动态路由

## Key Invariants

- Contract lifecycle: `pending → active → done/failed`，parent 合约感知 child 状态变更
- Handoff loop 有 maxIterations 保护（防无限循环）
- Write-lock 有 TTL 自动过期
- Employee YAML 校验走 employee-schema.ts (Zod)

## Commands

```bash
just server check   # covers orchestrator via src/ tsc
just server test    # includes orchestrator tests
```
