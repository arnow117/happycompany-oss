# E2E Journey Story Card: Session Runtime Review

## Story

- **Name**: Session Runtime Review
- **Owner/Reviewer**: Product + Engineering
- **Date**: 2026-06-04
- **Status**: Implemented

## Product Value

- **User**: 管理员 / 运营复盘人员
- **Business goal**: 聊天或工作流运行后，能通过 Sessions 和 Orchestration 追踪过程。
- **Why this should be Journey rather than Mainline/Probe**: 它跨运行结果、筛选、详情和日志复盘。

## Flow Boundary

- **Start state**: 至少存在一条 runtime session 或 workflow case。
- **End state**: 用户能找到、展开、理解并清理/复盘运行记录。
- **Primary route**: `/sessions`
- **Related routes**: `/orchestration`, `/chat`

## Scenario

1. 从 Chat 产生一次运行记录。
2. 在 Sessions 按租户/入口/actor 筛选并查看消息。
3. 在 Orchestration 查看协作日志或 timeline。

## Expected Evidence

- **Screenshot 1**: Sessions 筛选和列表。
- **Screenshot 2**: session 消息详情。
- **Screenshot 3**: Orchestration timeline。
- **Summary assertions**: 记录可查、筛选有效、详情可读、复盘链路可见。

## Data Boundary

- **Real profile data required**: 可使用 seed session/case。
- **Mocked data**: runtime sessions、messages、cases、timeline 可 mock。
- **Tenant / actor / employee assumptions**: `acme-happycompany`, `web-bot`, `u-sales-001`。

## Coverage Links

- **Mainline coverage**: `story-h-sessions`, `story-v2-product-journey`
- **Probe coverage**: `probe-orchestration-interactions`
- **Bug replay links**: 暂无

## Open Risks

- 当前 Journey 覆盖 Sessions 筛选、展开和回到 Chat；Orchestration 的筛选/详情由 Probe 覆盖。
- Sessions 页主内容区 select 目前没有 label 关联，E2E 暂用 `main select` 定位；若修复 a11y，应同步更新用例。
