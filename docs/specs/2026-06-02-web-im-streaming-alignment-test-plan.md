# Web/IM 流式输出对齐测试计划

**日期**: 2026-06-02

## 改动总览

Web Chat 与 IM 统一走 `MessageIngressRuntime`，WebSocket 协议改为后端权威的 `new_message` + `stream_event` + `stream_snapshot`，移除 `stream_delta` / `stream_done` / `stream_error` 兼容路径。

## 测试策略

- 单元测试：覆盖 `MessageIngressRuntime` 发布用户消息、流式事件、最终回复消息。
- 前端组件测试：覆盖 Chat store 对 `new_message`、`stream_event`、错误消息的合并和收口。
- E2E：更新 Chat WebSocket mock，验证发送消息、流式展示、最终消息转正。

## 新增/修改用例

- 发送用户消息后，后端发布 `new_message`，前端不再自行创建最终权威消息。
- `onText` 的累计文本在后端转换为 `text_delta` 增量事件。
- `onToolStart` / `onToolEnd` 转换为 `tool_use_start` / `tool_use_end`。
- 最终回复落库后发布 bot `new_message`，前端清理对应 streaming state。
- WebSocket 中断发布 `status: interrupted`，不再发送旧的 `stream_done`。

## 删除用例

- 删除或改写所有依赖 `stream_delta` / `stream_done` / `stream_error` 的测试，因为协议已废弃。

## 验证命令

```bash
npx vitest run tests/ingress/runtime.test.ts web/src/pages/Chat.test.tsx web/src/components/chat/MessageInput.test.tsx
cd web && npm run build
```
