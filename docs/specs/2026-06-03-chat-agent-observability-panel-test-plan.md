# Chat Agent Observability Panel Test Plan

**日期**: 2026-06-03

## 改动总览

在每条 bot 回复后显示一个默认收起的小型运行看板，展示本轮 Agent SDK 暴露的模型、session、耗时、token/cost、工具、交接、错误等观测信息。

## 测试策略

- 后端单元/集成：验证 SDK result/init/tool/handoff 信息被收集为消息级 `observability`，并随 `new_message` 推送与消息历史返回。
- 前端单元：验证 `ChatMessage.observability` 可解析，并在 bot 气泡中渲染默认收起的运行看板。
- E2E：通过 mock WebSocket 注入带观测信息的 bot message，确认 Chat 页可展开查看关键指标。

## 新增用例

- `MessageIngressRuntime` 收到 agent callbacks 后，bot message 包含 `observability.summary`、`model`、`sessionId`、`usage`、`toolCalls`。
- `MessageStore` 持久化并读取 message observability。
- `MessageBubble` 对 bot message 渲染“运行看板”，展开后显示模型、耗时、token、工具、交接。
- `Story Q` mock WebSocket 新消息带 observability 时，页面可展开看板并看到关键字段。

## 修改用例

- ChatView message parsing test 增加 `observability` 字段透传断言。
- 既有 runtime tests 保持原行为，新增断言不影响没有观测信息的 fake agent。

## 验证命令

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/ingress/runtime.test.ts tests/store.test.ts
cd web && npx vitest run src/components/chat/MessageBubble.test.tsx src/components/chat/ChatView.test.tsx
cd web && npx playwright test e2e/story-q-chat-websocket/story-q.spec.ts --project=chromium
npx tsc --noEmit
cd web && npm run build
```
