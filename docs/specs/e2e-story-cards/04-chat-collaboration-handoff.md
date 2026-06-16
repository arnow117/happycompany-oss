# E2E Journey Story Card: Chat Collaboration Handoff

## Story

- **Name**: Chat Collaboration Handoff
- **Owner/Reviewer**: Product + Engineering
- **Date**: 2026-06-04
- **Status**: Implemented

## Product Value

- **User**: 企业员工 / 业务用户
- **Business goal**: 用户发起请求后，平台能路由到合适数字员工，必要时转交，并展示可理解的过程。
- **Why this should be Journey rather than Mainline/Probe**: 它是产品核心体验，需要按用户对话故事展示。

## Flow Boundary

- **Start state**: Web 入口、actor 和员工绑定可用。
- **End state**: Chat 完成一次带 handoff/observability 的对话。
- **Primary route**: `/chat`
- **Related routes**: `/sessions`, `/orchestration`

## Scenario

1. 用户从 Web Chat 发起业务请求。
2. 数字员工流式回复，并在需要时转交。
3. 用户能展开观察信息，看到处理/转交流程。

## Expected Evidence

- **Screenshot 1**: Chat 初始选择和连接状态。
- **Screenshot 2**: 流式回复/转交过程。
- **Screenshot 3**: 最终回复和 observability。
- **Summary assertions**: 路由正确、流式正确、handoff 可见、错误状态可读。

## Data Boundary

- **Real profile data required**: 不强制。
- **Mocked data**: WebSocket message stream 可 mock。
- **Tenant / actor / employee assumptions**: `web-bot`, `u-sales-001`, `sales-zhangsan`。

## Coverage Links

- **Mainline coverage**: `story-q-chat-websocket`, `story-v2-product-journey`
- **Probe coverage**: 协议主线由 `story-q-chat-websocket` 覆盖；Chat UI 边界 Probe 在发现新 bug 时补。
- **Bug replay links**: 暂无

## Open Risks

- 需要区分“协议正确”与“业务回复质量”，E2E 只断言前者和可观测状态。
- 当前 Journey 使用显式 WebSocket mock，不验证真实模型回复质量。
