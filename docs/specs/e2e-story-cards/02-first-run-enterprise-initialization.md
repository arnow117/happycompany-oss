# E2E Journey Story Card: First Run Enterprise Initialization

## Story

- **Name**: First Run Enterprise Initialization
- **Owner/Reviewer**: Product + Engineering
- **Date**: 2026-06-04
- **Status**: Partial / mainline covered

## Product Value

- **User**: 首次部署平台的管理员
- **Business goal**: 完成模型配置、企业创建、员工网络准备和人员绑定引导。
- **Why this should be Journey rather than Mainline/Probe**: 它是首次上手体验，需要用截图证明引导是否清楚。

## Flow Boundary

- **Start state**: 未配置系统。
- **End state**: 系统达到 configured 状态，banner 隐藏或指向下一步。
- **Primary route**: `/model-config`
- **Related routes**: `/onboarding`, `/employees`, `/people`

## Scenario

1. 未配置系统进入控制台，看到模型配置引导。
2. 保存模型配置后进入企业/员工准备阶段。
3. 完成员工网络和人员绑定后，回到健康控制台。

## Expected Evidence

- **Screenshot 1**: 未配置 banner。
- **Screenshot 2**: 模型配置完成。
- **Screenshot 3**: 企业/员工准备完成。
- **Summary assertions**: 引导阶段正确、旧路由跳转正确、最终 configured。

## Data Boundary

- **Real profile data required**: 不强制，可用 explicit mocks。
- **Mocked data**: setup status、config save、tenant creation。
- **Tenant / actor / employee assumptions**: 新租户名由测试固定。

## Coverage Links

- **Mainline coverage**: `story-bootstrap`, `story-v2-product-journey`
- **Probe coverage**: Config 编辑能力由 `probe-config-editing` 间接覆盖
- **Bug replay links**: 暂无

## Open Risks

- 当前 setup 流程已有 Mainline 覆盖。只有当 onboarding 作为 release/demo 重点时，才需要补截图 Journey。
