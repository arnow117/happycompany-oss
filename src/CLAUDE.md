# src/ — Backend Server

> Inherits from /CLAUDE.md. Rules here ADD to root, never contradict.

## Architecture Constraints

- Dependency direction: `routes → business-api → core (bot, agent, store) → channel`. Never import from routes into core.
- `orchestrator/` is a self-contained subsystem. Other modules access it only through `orchestrator-runner.ts` and `employee-api.ts` — never import orchestrator internals directly.
- `ClaudeAgent` (agent.ts) owns the LLM session. No other module calls the Anthropic API directly.
- `runtime-profile.ts` is the business runtime model (entry/actor/session/workflow). Worktree startup isolation lives in `runtime-config-profile.ts`.

## Commands (scoped to server)

```bash
just server check      # tsc --noEmit (~3s)
just server pre-pr     # tsc + vitest run (~30s)
just server test       # vitest run
just server typecheck  # tsc --noEmit
```

## Prohibitions

| # | 禁止 | Rationale: 为什么 |
|---|------|-------------------|
| S1 | 不在 routes/ 中直接调用 Anthropic SDK | 所有 LLM 调用必须经过 ClaudeAgent，确保 session 一致性和 token 追踪 |
| S2 | 不从 routes/ 或 web 层直接 import orchestrator/ 内部模块 | orchestrator 只通过 runner/api 入口暴露，内部模块变更不影响外部 |
| S3 | 不新增 `any` 类型 | 项目当前 0 处 any，保持这个记录。用 `unknown` + narrowing |
| S4 | 不硬编码租户路径 | 使用 `tenant.ts` 的 `getTenantDir()` 获取路径，确保多租户兼容 |
| S5 | 不把 worktree profile 类型塞进 `runtime-profile.ts` | 该文件已承载业务会话模型，混名会让路由、harness、store 类型全部误解 |

## Self-Check Triggers

- **"加个 console.log 调试一下"** → 用 `logger` (Pino)。项目 0 处 console.log，保持。
- **"直接 import orchestrator/handoff-engine"** → 只能用 orchestrator-runner 和 employee-api 入口。
- **"给 route 加个新的 LLM 调用"** → 应走 ClaudeAgent.respond()。
- **"新增 RuntimeProfile 字段"** → 先判断是在改业务入口模型，还是在改 worktree 启动配置；后者放 `runtime-config-profile.ts`。

## File Size

dingtalk.ts (1008) 和 feishu.ts (815) 超 800 行上限。修改这两个文件时优先考虑提取共享逻辑到 `im-utils.ts`。

## Testing

- 测试必须在项目根目录运行：`cd happycompany && npx vitest run`
- Mock 外部 API（钉钉/飞书），不 mock 内部模块间调用
- 新增 src/ 模块必须有对应 tests/ 文件
