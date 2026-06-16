# Real Harness + Trace Hook Test Plan

## 改动总览

把 Harness 从纯 fake 回归扩展为可连接运行中后端的真实链路验收入口，并补齐 memory / handoff 的 `IngressTrace` 采集。

## 测试策略

- 单元/路由测试：验证 admin harness endpoint 能解析 YAML、调用 `MessageIngressRuntime`、返回 `HarnessCaseResult`。
- Web 页面测试：验证 `/harness` 能列出 case、展示最近报告、触发 suite run。
- CLI 行为测试：不在本轮用子进程压测 CLI；通过现有 fake suite 验证本地模式，通过路由测试覆盖 real mode 的服务端协议。
- Trace hook 测试：验证真实 memory MCP 工具调用 `onMemoryOp`；验证 orchestrator handoff 事件能进入 `RespondOptions.onHandoff`。
- 回归测试：保留现有 ingress / harness 单测，确保 fake fixture 和 StepRunner 不受影响。

## 新增用例

1. `POST /api/admin/harness/run`
   - 输入：包含 `yaml` 的 JSON body。
   - 预期：返回 `{ result }`，其中 `result.status === "passed"`，并包含 `IngressTrace`。

2. `POST /api/admin/harness/run` 非法 YAML
   - 输入：缺少必需字段的 YAML。
   - 预期：返回 400 和可读错误。

3. `GET /api/admin/harness/cases`
   - 输入：固定 fixture 目录。
   - 预期：返回 case summary，包含 channel、botName、关键 expect。

4. `POST /api/admin/harness/run-suite`
   - 输入：`caseIds` 可选。
   - 预期：返回 suite report，并可通过 latest report API 读取。

5. `memory_append` trace
   - 输入：调用 platform MCP memory append 工具。
   - 预期：`onMemoryOp` 收到 `{ operation: "append", subject, status: "ok" }`。

6. `memory_search` trace
   - 输入：调用 platform MCP memory search 工具。
   - 预期：`onMemoryOp` 收到 `{ operation: "search", subject, status: "ok" }`。

## 验证命令

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run \
  tests/routes/harness.test.ts \
  tests/mcp-tools.test.ts \
  tests/orchestrator/orchestrator-runner.test.ts \
  tests/ingress/trace-recorder.test.ts \
  tests/ingress/runtime.test.ts \
  tests/ingress/harness.test.ts \
  tests/ingress/phase6-routing.test.ts \
  tests/harness/step-runner.test.ts \
  tests/harness/evaluator.test.ts

npm run harness:fake
npm run harness:fake -- --output /tmp/happycompany-harness-report.json
just server harness
cd web && npm run test -- Harness.test.tsx web-navigation.test.tsx Layout.test.tsx
cd web && npm run build
```
