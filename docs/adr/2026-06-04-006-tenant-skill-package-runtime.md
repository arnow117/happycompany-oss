# ADR-006: Tenant Skill Package Runtime

**日期**: 2026-06-04
**状态**: 已采纳
**关联**: [业务 Skill Runner 与 MCP 边界收敛需求](../specs/2026-05-25-business-skill-runner-requirements.md), [ADR-005 runtime profile 隔离](./2026-06-04-005-runtime-profile-worktree-isolation.md)

## 背景

企业业务能力曾拆成两条目录语义：

- `corp/{tenant}/.claude/skills/{skill}/SKILL.md` 描述模型可理解的 skill。
- `corp/{tenant}/apps/{app}/tools.json` 和工程代码提供实际 tool manifest、CLI 与 server。

这会让同一个能力同时拥有 skill 和 app 两个身份。模型看到 skill，平台执行 app，维护者需要在两个目录里同步 description、command、schema 和工程代码。随着业务能力都通过 `run_skill` 收敛，`app` 已经成为旧抽象。

## 决策

企业租户下的业务工程统一收敛为 skill package：

```text
corp/{tenant}/.claude/skills/{skill}/
├── SKILL.md
├── tools.json
└── {skill}/
    ├── __init__.py
    ├── cli.py
    └── server.py
```

平台 ToolRegistry 只扫描 `corp/{tenant}/.claude/skills/{skill}/tools.json`。注册后的 `RegisteredTool` 必须携带 skill 目录，CLI 和 JSON-RPC server 都以该目录为执行 cwd。

`tools.json` 仍是平台运行时的结构化 manifest，负责 schema、riskLevel、server metadata 和 command 列表；`SKILL.md` 负责模型可读说明和 Claude Code skill 发现。

## 退化的内容

- `corp/{tenant}/apps/{app}/tools.json` 不再作为工具注册源。
- `app` 不再作为企业业务能力的用户心智。代码中仍可能保留少量兼容命名，但路径、执行目录和文档语义以 skill 为准。
- tenant root 下的 Python wrapper，例如 `corp/{tenant}/{skill}/cli.py`，不再是标准入口。

## 保留的内容

- `ToolRegistry` 保留，作为 skill package 的 manifest scanner。
- `tools.json` 保留，避免把复杂 JSON schema 和风险等级硬塞进 `SKILL.md` frontmatter。
- `run_skill` 仍是数字员工调用业务能力的唯一受控入口。
- 多个 skill 的共享企业代码可以放在 `corp/{tenant}/.claude/skills/_shared/` 下，但 `_shared` 不注册为 skill。

## 架构影响

| 模块 | 变更 |
|---|---|
| `src/tool-registry.ts` | 从 `.claude/skills/*/tools.json` 扫描 tool manifest，并记录 skill dir |
| `src/orchestrator/skill-runner.ts` | CLI cwd 改为 skill dir，执行 `python3 -m {skill}.cli` |
| `src/orchestrator/skill-bridge.ts` | 老业务 MCP fallback 使用 registry 的 skill dir，不再拼 `apps/{app}` |
| `src/app-server.ts` | server cwd 来自 skill dir，entry 相对 skill dir |
| 企业目录 | 业务代码迁入 `.claude/skills/{skill}/{skill}/` |
| 测试 fixture | `corp/acme` 测试租户迁移到 skill package 结构 |
