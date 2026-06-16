# Tenant Skill Package Runtime Test Plan

> 日期: 2026-06-04
> 状态: 草案
> 关联: [ADR-006 Tenant Skill Package Runtime](../adr/2026-06-04-006-tenant-skill-package-runtime.md)

## 改动总览

平台业务工具注册从 `corp/{tenant}/apps/{app}/tools.json` 收敛到 `corp/{tenant}/.claude/skills/{skill}/tools.json`，并让 CLI/server 从 skill package 目录执行。

## 测试策略

| 层级 | 覆盖点 |
|---|---|
| 单元测试 | ToolRegistry 只发现 skill package manifest，注册工具带 skillDir |
| 编排器测试 | SkillRunner 和 SkillBridge 调用 cwd 使用 skill dir |
| 集成测试 | 仓库内 `corp/acme` 测试租户可从 `.claude/skills/med_crm/tools.json` 注册 9 个工具 |
| 类型检查 | `RegisteredTool` 新字段在所有 mock 和调用点完整同步 |

## 新增用例

| 用例 | 输入 | 预期 |
|---|---|---|
| registry scans skill package | `corp/acme/.claude/skills/med_crm/tools.json` | 注册 `med_crm:*` tools，`getSkillServers()` cwd 为 skill dir |
| registry ignores legacy apps | 仅存在 `corp/acme/apps/legacy/tools.json` | 不注册 legacy tool |
| runner executes from skill dir | 员工绑定 `med_crm` 调 `global_search` | `callCli.cwd` 为 `.claude/skills/med_crm` |
| bridge executes CLI from skill dir | 无 server 的 registered tool | `callCli.cwd` 为 registered skill dir |

## 修改用例

- `tests/tool-registry.test.ts`：helper 写入 skill package。
- `tests/integration-tool-manifest.test.ts`：真实 fixture 路径迁移到 `.claude/skills/med_crm`。
- `tests/orchestrator/skill-runner.test.ts`：断言 CLI cwd。
- `tests/orchestrator/skill-bridge.test.ts`：mock `RegisteredTool.skillDir` 并断言 cwd。
- 依赖 `RegisteredTool` mock 的测试补齐 `skillDir`。

## 删除用例

- 删除或改写 `apps/*/tools.json` 被发现的预期。该行为是旧 app 概念，不再兼容。

## 验证命令

```bash
npx tsc --noEmit
npx vitest run tests/tool-registry.test.ts tests/integration-tool-manifest.test.ts tests/orchestrator/skill-runner.test.ts tests/orchestrator/skill-bridge.test.ts
```
