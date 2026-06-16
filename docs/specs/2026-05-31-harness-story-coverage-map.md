# Harness Story Coverage Map

## 目的

把 HappyCompany 现有测试故事拆成三类：继续保留 UI/API 自动化的部分、迁移到 Harness 的语义验收部分、以及两边都需要覆盖的关键链路。Harness 的职责不是替代浏览器，而是把“用户/IM/Web 发一句话后，数字员工是否路由、用工具、写记忆、转交、返回可用结果”变成稳定回归资产。

## 替代原则

- Vitest 继续覆盖确定性模块：权限、租户目录、工具注册、API contract、orchestrator 算法、store/runtime 单元行为。
- Playwright 继续覆盖浏览器行为：页面导航、表单、弹窗、布局、登录、WebSocket 连接、截图验收。
- Harness 覆盖消息语义：Web/钉钉/飞书/事件入口进入同一 `MessageIngressRuntime` 后的路由、工具选择、记忆边界、handoff 链路和回复质量。
- 真实后端 smoke 用 `npm run harness:real`，CI/本地快速回归用 `npm run harness:fake`。

## 现有故事映射

| 现有测试/故事 | 保留方式 | Harness 替代/增强 |
| --- | --- | --- |
| `web/e2e/story-digital-employees/*` | 保留员工列表、详情、fork、编辑和绑定 UI 验证 | 用 `bound-user-default-employee`、`selector-*`、`handoff-*` 验证绑定后的真实消息行为 |
| `web/e2e/story-v2-product-journey/*` | 保留产品端到端页面旅程和视觉验收 | 用医疗 CRM、记忆、转交 fixtures 镜像业务主线，避免只测到页面 mock |
| `web/e2e/story-j-chat/*`、`story-q-chat-websocket/*` | 保留聊天输入框、附件、stream/WS、错误态 UI | 用 `architecture-web-runtime-parity` 验证 Web 聊天和 IM 共享运行时语义 |
| `tests/orchestrator/*` | 保留 handoff engine、合同树、runner 的确定性单测 | 用 `multi-handoff-chain`、`acme-*` 验证用户消息能触发业务转交链 |
| `tests/mcp-tools.test.ts`、工具注册测试 | 保留工具 schema、权限和 handler 单测 | 用 `med-crm-*` 验证员工在业务语境下选择正确工具 |
| `tests/enterprise-people*`、绑定/租户测试 | 保留 people.json、roles、tenant boundary 单测 | 用 `bound-user-*`、`unbound-user-blocked` 验证绑定结果影响消息入口 |
| 管理后台页面故事 | 保留页面 CRUD、过滤、状态展示 | 用 `platform-admin-status-patrol` 验证平台管理员会话只读巡检 |
| 事件/调度故事 | 保留 scheduler API 和任务状态单测 | 用 `event-contract-signed-routes-service` 验证领域事件可以进入同一验收模型 |

## 当前 Harness 套件分层

| 分层 | Fixture 范围 | 验收重点 |
| --- | --- | --- |
| Runtime smoke | `echo-basic`、`architecture-*` | Web/IM/Harness 入口共用 trace 形态 |
| 绑定与选择 | `bound-user-*`、`selector-*`、`unbound-user-blocked` | 人与数字员工实例绑定、选择器、未绑定保护 |
| 示例医疗业务 | `sales-query-*`、`med-crm-*` | 医院客户、设备、维保、销售跟进、故障工单 |
| 记忆与权限 | `memory-*`、`auth-denied-tool-call` | 员工工作目录记忆边界、越权工具拒绝 |
| 员工协作 | `handoff-*`、`multi-handoff-chain`、`architecture-service-finance-handoff` | 跨员工转交链路完整记录 |
| 专业服务模板 | `acme-*` | 模板租户中项目经理到顾问/财务的结构化转交 |
| 平台运维 | `platform-admin-status-patrol` | 平台管理员只读巡检和工具约束 |
| 事件入口 | `event-contract-signed-routes-service` | 非聊天输入也能用同一 harness 语义验收 |
| 示例医疗终极准出 | 待新增 `acme-bid-win-to-contract-intake`、`acme-contract-intake-creates-maintenance-schedule`、`acme-maintenance-schedule-dispatch-to-receipt`、`acme-full-bid-contract-maintenance-finance-chain` | 招标中标、合同解析、维保定时任务、维修派单、现场日志、回执和财务闭环 |

## 后续完善方向

1. 给 Harness case 增加 tags/suites，让 `npm run harness:fake -- --suite med-crm` 这类局部回归更轻。
2. 增加断言字段：handoff target/order、tool argument、memory operation type、forbidden reply pattern。
3. 将 Playwright 业务语义断言下沉到 Harness，只在 UI 层断言“用户能触发并看到报告”。
4. 把真实后端 `run-suite` 结果持久化为 artifact，用于 PR 和发布验收对比。
