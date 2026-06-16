# E2E Journey Story Card: Entry Channel Configuration

## Story

- **Name**: Entry Channel Configuration
- **Owner/Reviewer**: Product + Engineering
- **Date**: 2026-06-04
- **Status**: Partial / probe covered

## Product Value

- **User**: 管理员 / 交付工程师
- **Business goal**: 配置 Web、钉钉、飞书入口，并确认入口能进入运行态。
- **Why this should be Journey rather than Mainline/Probe**: 入口配置影响平台接入真实业务消息，适合做面向交付的验收报告。

## Flow Boundary

- **Start state**: 已登录，租户存在，配置页可打开。
- **End state**: 至少一个 Web 入口可用，IM 入口展示正确安全状态。
- **Primary route**: `/config`
- **Related routes**: `/chat`, `/sessions`

## Scenario

1. 打开 Config，确认 Web 入口和 IM bot 分区。
2. 验证凭证遮蔽、渠道 label、租户选择、连接测试。
3. 进入 Chat 或 Sessions 确认配置后的入口可用。

## Expected Evidence

- **Screenshot 1**: Config 入口配置总览。
- **Screenshot 2**: 渠道/凭证/连接测试状态。
- **Screenshot 3**: 入口进入运行链路后的状态。
- **Summary assertions**: 配置可见、凭证安全、入口可运行。

## Data Boundary

- **Real profile data required**: e2e config 可提供 seed。
- **Mocked data**: 外部 IM 连接测试可 mock。
- **Tenant / actor / employee assumptions**: `acme-happycompany`, `web-bot`。

## Coverage Links

- **Mainline coverage**: `story-config-page`
- **Probe coverage**: `probe-config-editing`
- **Bug replay links**: 暂无

## Open Risks

- 不应该在 E2E 中写入真实生产凭证；POST 必须 mock 或使用 e2e config。只有渠道 onboarding 成为发布重点时，才补 Journey。
