# E2E Journey Story Card: Multi Tenant Isolation

## Story

- **Name**: Multi Tenant Isolation
- **Owner/Reviewer**: Product + Engineering
- **Date**: 2026-06-04
- **Status**: Implemented

## Product Value

- **User**: 多企业管理员 / 交付工程师
- **Business goal**: 切换企业时，入口、员工、知识、会话数据不会串租户。
- **Why this should be Journey rather than Mainline/Probe**: 多租户隔离是平台级信任能力，应该形成单独验收链路。

## Flow Boundary

- **Start state**: 至少两个 tenant 存在。
- **End state**: 切换 tenant 后关键页面展示对应数据，旧 tenant 数据不泄漏。
- **Primary route**: `/`
- **Related routes**: `/employees`, `/people`, `/chat`, `/sessions`, `/knowledge`, `/memory`

## Scenario

1. 从租户 A 进入控制台，确认员工/入口/会话。
2. 切换到租户 B，确认页面数据刷新。
3. 返回租户 A，确认状态恢复且不串数据。

## Expected Evidence

- **Screenshot 1**: 租户 A 状态。
- **Screenshot 2**: 租户 B 状态。
- **Screenshot 3**: 租户 A 恢复状态。
- **Summary assertions**: tenant selector 生效、页面数据隔离、会话状态重置。

## Data Boundary

- **Real profile data required**: 最好使用 e2e multi-tenant seed。
- **Mocked data**: tenants、employees、sessions、knowledge 可 mock。
- **Tenant / actor / employee assumptions**: `acme-happycompany`, `acme-demo`。

## Coverage Links

- **Mainline coverage**: 部分在 `story-v2-product-journey`
- **Probe coverage**: `probe-layout-shell`
- **Bug replay links**: 暂无

## Open Risks

- 当前 Journey 验证 Sessions 和 Orchestration 的用户可见隔离；底层 runtime profile/worktree 隔离由 ADR-005 和后端测试保障。
