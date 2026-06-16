# E2E Journey Reporting Strategy

**日期**: 2026-06-04
**状态**: 草案
**关联**: [产品就绪分层](./2026-06-01-product-readiness-layering.md), [Agent Builder 交互设计](./2026-05-31-agent-builder-interaction-design.md)

## 背景

HappyCompany 的 Web E2E 已经覆盖一批当前主线回归用例。需求迭代后，E2E 需要和产品一起增删改，不能把旧页面、旧路由和旧交互长期留在测试目录里。否则会导致两个问题：

- 默认 `npx playwright test` 应该回答“平台主线有没有坏”，旧用例会干扰判断。
- 产品迭代更需要“围绕一个功能或一条完整链路跑完流程，并输出带截图的测试报告”，而不是只看 pass/fail。

本策略把 E2E 分成主线回归、探索探针和旅程报告三类，让测试既能修问题，也能成为迭代验收材料。

## 目标

1. E2E 可以按功能、迭代或全链路组织测试。
2. 测试用例允许启发式地覆盖交互状态：正常路径、边界输入、旧问题复现、关键可视状态。
3. 修复问题时能先写或更新一个 focused E2E，再修代码，再把用例沉淀到合适层级。
4. 旅程报告模式必须输出 Playwright HTML report，并在关键步骤附带截图。
5. 历史用例如果不再代表当前平台价值，应直接删除或重写，不做长期停放区。

## 分层

| 层级 | 目的 | 默认运行 | 断言风格 | 截图 |
|------|------|----------|----------|------|
| Mainline 主线回归 | 判断当前平台主线是否健康 | 是 | 稳定、确定性、少截图 | 失败时截图 |
| Probe 探针 | 复现 bug、探索边界、验证修复方向 | 否 | 允许 focused，允许较窄 mock | 按需要 |
| Journey 报告 | 围绕一个功能/迭代/全链路走完整流程 | 否 | 用户可感知流程 + 关键状态断言 | 每个关键步骤截图 |

## 当前归类

### Mainline 主线回归

当前 `web/playwright.config.ts` 保持为默认主线回归入口。它覆盖：

- `story-bootstrap`
- `story-config-page`
- `story-h-sessions`
- `story-q-chat-websocket`
- `story-v2-*`

这组用例关注当前平台主线：模型配置、员工 Builder、数字员工目录、企业员工绑定、Config、Sessions、Chat WebSocket、Harness、Orchestration。

### Journey 报告

新增 `web/playwright.report.config.ts` 作为旅程报告入口。默认包含：

- `journey-*` 目录下的未来报告用例
- `journey-console-overview`，作为报告模式样例

未来每个报告用例应围绕一个明确主题命名：

```text
web/e2e/journey-{feature-or-iteration}/journey.spec.ts
```

示例：

```text
web/e2e/journey-agent-builder-publish/journey.spec.ts
web/e2e/journey-enterprise-onboarding/journey.spec.ts
web/e2e/journey-chat-handoff-observability/journey.spec.ts
```

### Probe 探针

当修 bug 或探索新交互时，可以先写 focused probe：

```text
web/e2e/probe-{issue-or-risk}/probe.spec.ts
```

Probe 不进入默认主线回归。修复完成后：

- 如果是核心主线风险，迁移为 Mainline 用例。
- 如果是用户可见流程，迁移为 Journey。
- 如果只是一次性排查，修完后删除。

### Bug Replay

真实手点发现的问题先变成最小 Probe：

1. 写出失败复现。
2. 确认失败原因和 bug 一致。
3. 修代码。
4. 复现用例通过。
5. 判断是否升级到 Mainline/Journey，或作为一次性诊断用例删除。

## 启发式用例生成

围绕某个功能生成 E2E 时，按下面顺序挑选用例，不要求全选：

1. **入口启发**：用户从哪个入口进入？侧边栏、dashboard action、legacy redirect、深链 URL 是否都成立？
2. **角色启发**：管理员、企业员工、入口 bot、数字员工分别能看到什么？
3. **数据状态启发**：空状态、单条数据、多条数据、跨租户数据、失败数据。
4. **交互启发**：创建、编辑、保存、取消、删除、切换 tab、筛选、展开详情。
5. **边界启发**：必填缺失、超权限工具、连接断开、后端错误、旧 session。
6. **观测启发**：状态 badge、toast、日志、trace、handoff、session 链路是否可见。
7. **回归启发**：最近修过的问题要有一个最小复现步骤。

## E2E Diff Review

每次需求迭代后，必须审一遍 E2E 变化，不只新增：

1. **Add**：新增用户价值、新流程、新交互状态、新发现 bug。
2. **Update**：业务价值仍存在，但路由、文案、数据契约、交互状态变了。
3. **Delete**：页面/路由消失、流程被替代、测试验证旧实现细节、无法映射当前用户价值。
4. **Reclassify**：Probe/Bug Replay 升级到 Mainline；Mainline 降级到 Journey；Journey 过期后删除。

## 报告格式

Journey 报告至少包含：

- 标题：功能、迭代或全链路名称。
- 前置条件：mock 数据或真实 profile。
- 步骤截图：每个关键用户动作或关键状态一张截图。
- 断言摘要：哪些状态被验证。
- 风险记录：哪些部分是 mock，哪些部分依赖真实后端。

截图应通过 `web/e2e/reporting.ts` 的 helper 捕获并 attach 到 Playwright report。对于需要沉淀到文档的固定截图，可以继续写入 `docs/reports/*-assets/`，但测试报告本身以 Playwright HTML 为准。

## 命令

```bash
cd web

# 默认主线回归
npm run test:e2e:mainline

# 带截图旅程报告
npm run test:e2e:report

# 查看当前默认会跑哪些用例
npm run test:e2e:list
```

## Done 标准

一个功能迭代完成时，至少满足：

- 有一个 Mainline 或 Journey 覆盖主要用户价值。
- 如果修了历史 bug，有一个 Probe 或 Mainline 复现原问题。
- Journey 报告中能看到关键截图，而不是只靠命令行 pass。
- 旧用例若被发现过时，要更新、重写或删除，不做长期停放区。
