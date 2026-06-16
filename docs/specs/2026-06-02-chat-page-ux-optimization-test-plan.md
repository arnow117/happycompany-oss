# Chat Page UX Optimization Test Plan

**日期**: 2026-06-02

## 改动总览

优化 Chat 页的上下文选择、空态引导、输入区状态反馈，并补齐按会话恢复草稿的行为。

## 测试策略

- 组件测试覆盖 `ChatView` 的运行时上下文展示与输入状态传递。
- 组件测试覆盖 `MessageInput` 的会话草稿恢复与断连禁用提示。
- 前端构建验证 TypeScript 与 Vite 输出。

## 新增用例

- `ChatView` 在运行时入口加载后显示入口、发起人、目标员工与当前投递对象。
- `MessageInput` 切换 `draftKey` 后恢复对应会话草稿。
- `MessageInput` 在禁用时显示状态提示且不发送消息。

## 修改用例

- 现有 `ChatView` mock 需要接收新增的输入/消息展示 props。
- 现有 `MessageInput` slash command 用例保持不变。

## 验证命令

```bash
cd happycompany && npx vitest run web/src/components/chat/MessageInput.test.tsx web/src/components/chat/ChatView.test.tsx web/src/pages/Chat.test.tsx
cd happycompany/web && npm run build
```
