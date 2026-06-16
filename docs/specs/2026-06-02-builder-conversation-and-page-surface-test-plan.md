# Builder 对话式构建与 Web 页面收口测试计划

**日期**: 2026-06-02
**关联 ADR**: [ADR-004 Runtime Profile 统一入口、会话、Builder 与多员工工作流](../adr/2026-06-02-004-runtime-profile-entry-session-builder-workflow.md)

## 目标

- Agent Builder 从三段式面板改为对话式引导：需求、草稿、配置、校验、测试、沙盒、发布都在同一条构建流中推进。
- 右侧保留独立 Preview 对话窗口，Preview 通过 `builder_sandbox` Runtime 发送消息，结果仍作为发布门禁。
- Web 平台导航收口到 Runtime Profile 模型下的一等页面，旧页面不再作为主入口。

## 页面收口

| 旧页面 / URL | 新事实源 | 验证方式 |
| --- | --- | --- |
| `/employee-network` | `/employees` + `/agent-builder` | 旧 URL redirect，新 E2E 不再保护旧向导 |
| `/people-binding` | `/people` | 旧 URL redirect，人员绑定能力由 People 页承接 |
| `/entry-routing` / `/bots` | `/config` | 旧 URL redirect，入口配置归入 Config |
| `/capabilities` | `/skills-marketplace` / `/employees` | 旧 URL redirect，能力资产归入工具/员工视图 |
| `/agent-status` | `/sessions` | 旧 URL redirect，会话和运行状态归入 Sessions |
| `/scheduler` | `/orchestration` | 旧 URL redirect，工作流执行入口归入 Workflows |

## 测试调整

- 保留并更新 `AgentBuilder.test.tsx`：验证草稿生成、配置编辑、校验、Harness、Preview 沙盒、发布门禁。
- 保留并更新 `Layout.test.tsx`：验证导航只展示 Chat、Sessions、Workflows、Builder、Employees、People、Tools、Config、Memory、Harness 等新入口。
- 更新 Bootstrap E2E：旧 `/employee-network`、`/people-binding` 只验证 redirect，不再测试旧页面交互。
- 更新 Product Journey E2E：导航不再出现旧高级诊断组，`/entry-routing` redirect 到 Config。
- 删除下线页面的组件级测试：`AgentStatus.test.tsx`、`Capabilities.test.tsx`、`EmployeeNetwork.test.tsx`、`PeopleBinding.test.tsx`。

## 验证命令

```bash
cd web && npm run test -- AgentBuilder.test.tsx Layout.test.tsx OnboardingBanner.test.tsx ModelConfig.test.tsx Config.test.tsx Sessions.test.tsx ChatView.test.tsx Orchestration.test.tsx
npm run typecheck
cd web && npm run build
cd web && npx playwright test --reporter=line
```
