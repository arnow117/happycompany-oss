# Collaboration Workflow Cases Test Plan

**日期**: 2026-06-02

## 改动总览

将“多员工工作流”从手动 WorkflowThread 页面重做为协同日志页面，并在 Chat streaming 中展示 handoff 协同提示。

## 测试策略

- Store 单元测试：验证 Runtime 协同事件可持久化、查询、聚合。
- Runtime API 测试：验证 `/api/runtime/cases` 和 timeline。
- 前端单元测试：验证协同日志页面展示 case/timeline，Chat 收到 handoff stream event 后显示协同模块。
- E2E：更新产品旅程中 `/orchestration` 断言，不再期待创建 Workflow。

## 新增用例

1. Store 持久化 runtime events。
   - 输入：routing/tool/handoff/error events。
   - 预期：按 session 和时间顺序返回。

2. Runtime cases 聚合。
   - 输入：一个 Runtime session、消息、handoff/tool events。
   - 预期：case 显示 participants、handoffCount、toolCallCount、preview、lastMessageAt。

3. Timeline 聚合。
   - 输入：session messages + events。
   - 预期：返回 user message、agent message、handoff、tool call 等统一事件。

4. Chat handoff streaming。
   - 输入：WebSocket `stream_event`，`eventType: 'handoff'`。
   - 预期：Chat streaming 区显示 “from -> to” 和原因。

5. 协同日志页面。
   - 输入：mock cases/timeline API。
   - 预期：页面显示协同事项列表、handoff 轨迹和工具调用。

## 修改用例

- `web/src/pages/Orchestration.test.tsx`：从 WorkflowThread 创建/发送测试改为协同日志展示测试。
- E2E `/orchestration`：不再断言 `Workflow Threads` 和 `创建 Workflow`，改为断言协同日志和 timeline。

## 验证命令

```bash
npx vitest run tests/store.test.ts tests/routes/runtime-routes.test.ts
cd web && npm run test -- Orchestration.test.tsx ChatView.test.tsx
cd web && npm run build
cd web && npx playwright test web/e2e/story-v2-product-journey/story-v2.spec.ts
```

