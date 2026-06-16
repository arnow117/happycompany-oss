# E2E Journey Story Card: Acme Ultimate Acceptance

## Story

- **Name**: Acme Ultimate Acceptance
- **Owner/Reviewer**: Product + Engineering + Acme Operator
- **Date**: 2026-06-04
- **Status**: Acceptance passed; real tenant write tools enabled with backup

## Product Value

- **User**: 示例医疗销售、财务、维修负责人和平台验收人。
- **Business goal**: 证明 HappyCompany 能处理示例医疗真实长链路业务：招标中标、合同录入、维保定时、派单、现场维修、回执和财务闭环。
- **Why this should be Journey rather than Mainline/Probe**: 这是跨页面、跨员工、跨工具、跨定时任务的产品故事。Mainline 只适合保留稳定回归断言，Probe 只适合补具体交互 bug。

## Flow Boundary

- **Start state**: `acme-happycompany` 租户存在销售张三、财务王五、维修李四，且存在可查询的杭州示例医疗中标/维保样本。
- **End state**: 财务完成合同/维修闭环，平台可查看 session trace、handoff、scheduler task、维修日志、SERVICE RECORD 和 memory。
- **Primary route**: `/chat`, `/workflows`, `/harness`
- **Related routes**: `/sessions`, `/memory`, `/orchestration`

## Scenario

1. 用户让销售张三跟进“杭州示例医疗”招标机会，销售查询并确认中标记录。
2. 销售张三发现合同文件缺失或拿到合同后，把中标/合同信息交接给财务王五。
3. 财务王五录入合同并解析服务期、维修周期、响应 SLA 和付款条款。
4. 财务王五创建维保 scheduler task。
5. 测试手动触发 scheduler task，任务进入财务会话。
6. 财务王五派单给维修李四。
7. 维修李四查询医院、设备、历史维保和说明书，形成现场处理计划。
8. 维修李四记录现场维修日志、备件情况和客户签字，生成 SERVICE RECORD。
9. 维修李四把回执和结算依据交回财务王五。
10. 财务王五记录开票/回款/归档状态，并回复最终处理结果。

## Expected Evidence

- **Screenshot 1**: Chat 中销售查询杭州示例医疗中标记录，并展示中标项目、医院、金额、合同状态。
- **Screenshot 2**: Workflows 或 Sessions 中展示销售到财务的 handoff trace 和合同字段。
- **Screenshot 3**: Scheduler/Workflows 中展示合同解析后生成的维保任务。
- **Screenshot 4**: 维修李四任务详情展示说明书/历史维保查询、现场日志和 SERVICE RECORD。
- **Screenshot 5**: 财务王五收到回执并完成结算/归档反馈。
- **Summary assertions**: 中标可查、合同可解析、任务可创建、任务可触发、派单可见、维修日志可写、回执可回财务、memory 可检索。

## Data Boundary

- **Real profile data required**: `acme-happycompany` 租户；杭州示例医疗中标样本；至少一个维保合同样本；至少一个合同文件或结构化合同 fixture。
- **Mocked data**: OCR 可在初期使用 fixture 字段模拟；现场签字图片可用固定测试附件；外部招标网站不在 E2E 中实时请求。
- **Tenant / actor / employee assumptions**: Tenant 为 `acme-happycompany`；销售 `sales-zhangsan`；财务 `finance-wangwu`；维修 `maintenance-lisi`。

## Coverage Links

- **Mainline coverage**: 待新增 `story-acme-ultimate-acceptance` 的稳定可见性断言；现有 `story-q-chat-websocket` 和 `journey-chat-collaboration-handoff` 只覆盖 handoff 子集。
- **Probe coverage**: 未来按 bug 增加合同字段复核、scheduler task 创建、派单确认、回执表单校验等 probe。
- **Bug replay links**: 暂无。

## Current Evidence

- CLI acceptance runner 已在隔离 SQLite 中跑通 Flow A / Flow B，并生成 `contract_intake`、`maintenance_schedule`、`service_incident`、`service_record`、`finance_settlement` 五类产物。
- Real tenant enablement 已在明确授权后执行带备份 staging，启用 `contract_intake`、`create_service_record`、`finance_settlement`，备份目录为 `../corp/acme-happycompany/.claude/skills/med_crm/.backups/backup-2026-06-04T14-10-02-981Z`。
- Real tenant readiness verifier 已只读检查真实 `../corp/acme-happycompany`，当前状态为 `passed`：toolCount=12，三项写入工具齐全，并使用真实租户 skill package 跑通 Flow A / Flow B。
- Shadow tenant acceptance 已读取真实 `acme-happycompany` med_crm package 到临时目录，并跑通 Flow A / Flow B，确认 `targetModified=false`。
- Runtime profile acceptance 已在 workspace 内创建隔离 `.runtime` profile，复制真实租户、应用写入工具、跑通 Flow A / Flow B，并验证 `ToolRegistry.scan()` 可 lookup 三项写入工具。
- Memory acceptance 已用真实 `MemoryManager` 给财务王五和维修李四写入 Flow A / Flow B 关键事实，并验证合同、维保周期、SERVICE RECORD 和财务结算关键词可检索。
- Acceptance suite `npm run acme:acceptance` 当前状态为 `passed`，`nextGate=real-tenant-ready`。
- Journey `web/e2e/journey-acme-ultimate-acceptance/journey.spec.ts` 已通过，并产出 Harness / Orchestration 页面截图。
- `tests/integration-acme-scheduler-runtime.test.ts` 已覆盖 scheduler trigger 进入 MessageIngressRuntime 后的 memory、tool、handoff、business_artifact 和 `run_count` 持久化。
- 产品侧报告见 `docs/reports/2026-06-04-acme-ultimate-acceptance-story-review.html`。

## Open Risks

- Journey 页面部分使用确定性 E2E 数据展示结果；真实 med_crm 写入在 Journey 开始前通过 CLI acceptance runner 验证。
- 合同 OCR、人工复核、派单状态机、真实说明书检索、附件签字图片仍需要产品化。
- 流程很依赖长会话，后续仍必须把多轮上下文、员工 memory 和 session trace 纳入真实租户验收，而不是只看最终回复。
