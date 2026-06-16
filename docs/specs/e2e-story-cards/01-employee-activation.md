# E2E Journey Story Card: Employee Activation

## Story

- **Name**: Employee Activation
- **Owner/Reviewer**: Product + Engineering
- **Date**: 2026-06-04
- **Status**: Implemented baseline

## Product Value

- **User**: 平台管理员
- **Business goal**: 从员工创建、发布、绑定到 Chat 使用，证明一个数字员工能进入真实业务链路。
- **Why this should be Journey rather than Mainline/Probe**: 它跨 Builder、Employees、People、Chat、Sessions/Orchestration，是平台核心价值链路。

## Flow Boundary

- **Start state**: 已登录控制台，租户存在，模型配置可用。
- **End state**: 数字员工已发布、已绑定企业员工，用户通过 Web Chat 完成对话，并能在运行记录中追踪。
- **Primary route**: `/agent-builder`
- **Related routes**: `/employees`, `/people`, `/chat`, `/sessions`, `/orchestration`

## Scenario

1. 在 Agent Builder 创建并发布销售数字员工。
2. 在 Employees 确认员工进入目录，并在 People 中绑定企业员工/assistant。
3. 通过 Chat 发起两轮业务对话，再到 Sessions 或 Orchestration 查看运行痕迹。

## Expected Evidence

- **Screenshot 1**: Builder 中 draft/publish 状态。
- **Screenshot 2**: Employees 中已发布员工。
- **Screenshot 3**: Chat 对话和运行追踪。
- **Summary assertions**: 发布成功、绑定成功、对话成功、运行记录可见。

## Data Boundary

- **Real profile data required**: 优先使用 e2e seed profile。
- **Mocked data**: 可 mock LLM 回复和 WebSocket 流式事件。
- **Tenant / actor / employee assumptions**: `acme-happycompany`, `web-bot`, `sales-zhangsan`, `u-sales-001`。

## Coverage Links

- **Mainline coverage**: `story-v2-product-journey`, `story-q-chat-websocket`, `story-h-sessions`
- **Probe coverage**: `probe-enterprise-people-binding`
- **Bug replay links**: 暂无

## Open Risks

- 当前 Journey 使用显式 mock 验证关键状态；如 Builder UX 稳定，可再加深为真实点击发布流程。
