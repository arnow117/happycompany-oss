# Agent Builder CLAUDE.md 对齐测试计划

日期：2026-05-31

## 改动总览

发布数字员工时生成员工 workspace `CLAUDE.md`，并把运行时长期人格来源对齐到 Claude Agent SDK 的 `systemPrompt.append`。

## 测试策略

| 层级 | 覆盖点 |
|---|---|
| 单元测试 | `CLAUDE.md` 渲染格式、空字段处理、运行时 prompt 不重复注入长期 systemPrompt |
| 路由/集成测试 | Agent Builder 发布后 workspace 存在 `CLAUDE.md`，内容包含员工身份、工作说明、skills/tools/allowedTargets |
| 迁移验证 | `corp/acme/agents/*/CLAUDE.md` 已生成 |
| 回归测试 | Agent Builder、EmployeeManager、Harness 相关测试继续通过 |

## 新增用例

1. 渲染员工 `CLAUDE.md`
   - 输入：包含 displayName、description、systemPrompt、skills、tools、allowedTargets、capabilities 的员工定义。
   - 预期：输出包含身份、职责、长期工作说明、能力包、工具、转交对象和工作边界。

2. Builder 发布写入 `CLAUDE.md`
   - 输入：自然语言创建并发布一个数字员工。
   - 预期：发布结果 workspace 存在；workspace 下 `CLAUDE.md` 存在；内容包含员工 displayName、systemPrompt、skills、tools。

3. 运行时不重复注入 YAML `systemPrompt`
   - 输入：带 `systemPrompt` 的员工执行一次任务。
   - 预期：传给 `agent.respond` 的 prompt 包含用户消息和命令规则，但不包含完整 `systemPrompt`。

4. 示例医疗历史员工迁移
   - 输入：`corp/acme/employees/*.yaml`。
   - 预期：每个员工对应的 `corp/acme/agents/{id}/CLAUDE.md` 存在。

## 验证命令

```bash
npx vitest run tests/orchestrator/employee-prompt.test.ts tests/orchestrator/employee-colony.test.ts tests/routes/agent-builder.test.ts
npx vitest run
```
