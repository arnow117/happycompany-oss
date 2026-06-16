# Acme Ultimate Acceptance Workflows

Date: 2026-06-04

## Purpose

这份文档记录示例医疗在 HappyCompany 中的“终极准出”业务流程。它不是普通 demo story，而是判断数字员工平台是否真正能处理示例医疗业务的验收线。

准出标准：平台必须能把招标、中标、合同、维修周期、定时任务、维修派单、现场记录、回执和财务反馈串成可追踪、可复跑、可审计的多员工长链路。

## Real Business Flows

### Flow A: 招标跟进到合同入库和维保计划

用户目标：销售数字员工持续跟进招标机会，确认杭州示例医疗中标后，把合同交给财务。财务完成合同录入，解析维修周期，并创建后续维修定时任务。

目标路径：

1. 销售张三通过招标/中标工具查询“杭州示例医疗”相关机会。
2. 销售张三识别中标公告、医院、项目号、金额、合同链接或缺失合同状态。
3. 销售张三把中标结果、客户医院、项目、金额和待补材料交给财务王五。
4. 财务王五接收合同文件或合同字段，完成合同录入。
5. 财务王五解析合同中的服务周期、保养频次、响应要求、付款条款和特殊排除项。
6. 财务王五创建维修定时任务，任务必须指向正确医院、设备、合同、服务期和维修员工。
7. 平台记录长会话 trace：工具调用、合同字段、memory 写入、handoff、scheduler task 创建结果。

### Flow B: 维保定时任务到维修回执和财务闭环

用户目标：维修定时任务触发后，财务派单给维修数字员工。维修员工查阅说明书，到医院现场维修或保养，记录实际情况和维修日志，维修完成后记录回执并反馈财务。

目标路径：

1. Scheduler 到期触发合同维保任务。
2. 任务进入同一个 MessageIngressRuntime，而不是旁路脚本。
3. 财务王五看到任务触发、合同上下文和维修周期，派单给维修李四。
4. 维修李四查询医院、设备、合同、历史维保和说明书/知识库。
5. 维修李四形成现场任务计划，包括到达时限、需要检查的部件、合同范围内/外判断。
6. 维修李四记录现场实际情况、诊断过程、维修日志、备件使用和客户签字状态。
7. 维修李四生成 SERVICE RECORD 回执。
8. 维修李四把回执、结算金额、付款依据、异常项和后续建议 handoff 给财务王五。
9. 财务王五更新合同/回款/开票/归档状态，并把处理结果反馈给发起人。

## Concrete Acme Data Anchors

当前示例数据可以作为验收样本：

| 样本 | 现状 | 验收价值 |
| --- | --- | --- |
| 中标记录 `6428` | 项目号 `330382263180160000008-WZLCZB-2026-03047`，2026-04-07，乐清市第三人民医院，供应商杭州示例医疗器械有限公司，金额 161.8 万，阶段 result，合同链接为空 | 可验证“中标后合同缺失，需要销售/财务继续跟进” |
| 维保合同 `45` | 杭州市余杭区第一人民医院，2台 620 CT维保服务项目，GE，合同期 2024-03-31 到 2026-03-30，保养 0/4 次，下次为空 | 可验证“合同存在但保养计划未生成或未回填 next run” |
| 合同样本 `jsrm-540ct-full-service` | 江山市人民医院 GE16排 CT，2024-09-03 到 2027-09-02，金额 1710000，每半年验收开票付款 | 可验证“合同解析出半年维保/结算周期” |
| 合同样本 `hzjt-520ct-technical-service` | 湖州交通医院 GE OPTIMA CT520，2026-03-27 到 2027-03-26，每年2次保养，2小时响应，一个工作日到场 | 可验证“合同解析出保养频次和响应 SLA” |

## Current Product State

已经具备：

- `acme-happycompany` 租户下存在销售张三、维修李四、财务王五。
- `med_crm` skill 已提供医院、设备、维保、中标、销售活动、故障工单等读写工具。
- `contract-service-chain` 已描述销售签约、维修执行、回执、财务结算的跨员工链路。
- Harness fake smoke `acme-happycompany-contract-service-chain` 可以验证销售签约字段确认的最小路径。
- Web E2E 已有 chat handoff story，覆盖销售转维修的协同可见性。
- Scheduler 基础 CRUD 和触发能力存在。
- Memory 已可按租户/员工写入和查询，可作为长会话偏好、合同跟进和服务经验沉淀位置。
- 仓库内 `corp/acme/.claude/skills/med_crm` 已补齐三项写入工具：`contract_intake`、`create_service_record`、`finance_settlement`。
- 真实运行租户 `../corp/acme-happycompany` 已在备份后启用三项写入工具，备份目录为 `../corp/acme-happycompany/.claude/skills/med_crm/.backups/backup-2026-06-04T14-10-02-981Z`。
- Harness trace 已支持 business artifact、memory operation、handoff chain 和 tool call 断言。
- 示例医疗两条流程已有可复跑 acceptance suite：CLI acceptance、shadow tenant、runtime profile、memory acceptance、real tenant readiness。
- Journey `web/e2e/journey-acme-ultimate-acceptance` 已生成产品截图，展示 Harness、Orchestration 和 Memory 侧证据。

仍未闭环：

- 招标跟进还没有产品化为长期监控状态机；当前通过可复跑验收样本证明“查到中标并移交合同 intake”。
- 合同文件上传、OCR、字段解析和人工复核页面还没有接入 HappyCompany 运行时；当前通过结构化合同 fixture 验证字段解析和维保计划。
- 维修派单状态模型仍是验收链路产物，而不是完整任务看板状态机，例如 assigned、accepted、on_site、completed、receipt_submitted。
- 说明书/设备知识库尚未接入 `acme-happycompany` skill package；当前 Flow B 用说明书查询意图和维修日志产物证明链路位置。
- SERVICE RECORD 回执已能通过写工具落库并回传财务，但附件、签字图片和异常补录仍需产品化。

## Release Gate

### P0: 不满足则不能宣称示例医疗流程开箱即用

- 招标查询能在 `acme-happycompany` 租户内查到杭州示例医疗中标样本，并能识别合同缺失/待跟进。
- 销售张三能把中标机会 handoff 给财务王五，trace 中可见业务字段和 handoff reason。
- 财务王五能录入或接收合同字段，并解析出服务期、维修/保养周期、付款条款和响应 SLA。
- 合同解析结果能创建 scheduler task，task 指向正确租户、合同、医院、设备和目标员工。
- Scheduler 触发后必须进入 `MessageIngressRuntime`，并产生可回放的 session trace。
- 财务王五能把到期维保任务派单给维修李四。
- 维修李四能查询设备/合同/历史维保/说明书，并输出现场处理计划。
- 维修李四能写入维修日志和 SERVICE RECORD 回执。
- 维修李四完成后必须 handoff 回财务王五，财务能记录结算/开票/归档结果。
- Memory 必须记录至少两类信息：客户/设备长期偏好或注意事项，以及本次合同/维修链路的关键事实。
- Harness real case 必须断言 routed employee、tool calls、memory operations、handoff chain、scheduler side effect 和 final business artifact。

### P1: 可演示但仍需产品化

- 支持合同 OCR 人工复核页面，展示低置信字段。
- 支持维修任务列表按医院、设备、合同和到期时间筛选。
- 支持异常分支：合同缺失、合同已过期、服务不在合同范围、客户未签字、备件另计费。
- 支持从 Web Chat、Harness、Scheduler 三个入口跑出一致 trace。
- 支持在 Memory 页面查看并编辑员工沉淀的合同/客户/设备经验。

### P2: 规模化运营

- 招标跟进支持按关键词、医院、供应商和地区配置长期监控。
- 维保计划支持批量生成、节假日顺延、负责人变更和逾期告警。
- 维修说明书和历史案例支持相似设备召回。
- 财务结算支持发票、应收、回款和归档系统集成。

## Test Strategy

当前准出命令：

```bash
npm run acme:acceptance
```

该命令生成 `docs/reports/2026-06-04-acme-acceptance-suite-run.json`，并汇总：

- CLI acceptance：隔离 SQLite 中跑通 Flow A / Flow B。
- Shadow tenant：复制真实租户到临时目录，叠加已验证工具后跑通，确认不修改真实租户。
- Runtime profile：复制真实租户到 `.runtime/<profile>`，验证工具注册和 Flow A / Flow B。
- Memory acceptance：用真实 `MemoryManager` 写入并检索财务王五、维修李四的流程记忆。
- Real tenant readiness：只读检查真实 `../corp/acme-happycompany` 是否已具备写工具，并使用真实租户 skill package 跑 Flow A / Flow B。

### Harness

应新增真实语义验收：

- `acme-bid-win-to-contract-intake`
- `acme-contract-intake-creates-maintenance-schedule`
- `acme-maintenance-schedule-dispatch-to-receipt`
- `acme-full-bid-contract-maintenance-finance-chain`

每个 case 至少断言：

- `routedEmployee`
- `toolNamesIncludes`
- `handoffChain`
- `memoryOperations`
- `schedulerTaskCreated` 或 `schedulerTaskTriggered`
- `businessArtifactCreated`，例如 contract、maintenance_schedule、service_record、finance_settlement

### Playwright

应新增 Journey，而不是只新增 Mainline：

- Journey 展示从 Web Chat 或 Workflows 入口触发完整长链路。
- Journey 报告必须展示合同解析结果、scheduler task、派单、维修日志、回执和财务反馈。
- Probe 只覆盖具体交互 bug，例如合同字段复核、派单确认、回执表单校验。

### Unit / Integration

需要补齐确定性测试：

- 合同周期解析。
- 维保计划生成。
- Scheduler trigger payload。
- 财务派单状态机。
- 维修日志和回执 schema。
- 租户隔离：所有合同、任务、memory、回执都必须落在 `acme-happycompany`。

## Definition Of Done

示例医疗流程达到开箱即用，必须同时满足：

1. 用真实或接近真实的示例医疗租户数据运行一次 Flow A。
2. Flow A 产生持久化合同记录、结构化维保计划和 scheduler task。
3. 手动或自动触发该 scheduler task 后运行 Flow B。
4. Flow B 产生维修日志、SERVICE RECORD 回执和财务处理结果。
5. 全链路 trace 在 Chat/Sessions/Workflows/Harness 中至少一个产品界面可读。
6. Memory 页面能检索到本次链路沉淀的员工记忆。
7. `npm run acme:acceptance` 或等价命令能复跑核心 case。
8. `cd web && npm run test:e2e:mainline` 不因该链路的 UI 基础能力回归而失败。

## Immediate Demo Boundary

当前可以诚实演示：

- 隔离 CLI acceptance 跑通招标中标、合同 intake、维保计划、维修日志、SERVICE RECORD、财务结算五类产物。
- 真实 `acme-happycompany` 租户已启用写入工具，并通过 real tenant readiness acceptance。
- Shadow tenant acceptance 使用真实 `acme-happycompany` 租户拷贝跑通，且不修改真实租户。
- Runtime profile acceptance 在隔离运行态中验证 ToolRegistry 可识别三项写入工具，并跑通 Flow A / Flow B。
- Memory acceptance 展示财务王五和维修李四的合同、维保周期、SERVICE RECORD 和结算记忆。
- Web Journey 展示 Harness、Orchestration、Memory 三个视角的截图证据。

当前不能诚实宣称的是：

- 外部招标网站长期监控、合同 OCR/人工复核、真实说明书检索、签字附件和完整维修状态看板已产品化。

## Tenant Enablement

仓库内 `corp/acme/.claude/skills/med_crm` 已提供可复跑的写入命令：

- `contract_intake`
- `create_service_record`
- `finance_settlement`

真实运行租户 `../corp/acme-happycompany` 默认不应被自动覆盖。2026-06-04 已经在明确授权后执行带备份启用，启用报告见：

```bash
docs/reports/2026-06-04-acme-real-tenant-enable-run.json
```

备份目录：

```bash
../corp/acme-happycompany/.claude/skills/med_crm/.backups/backup-2026-06-04T14-10-02-981Z
```

后续如需重新检查，先做只读检查：

```bash
node scripts/stage-acme-med-crm-write-tools.mjs
```

如需重新应用，检查通过且确认可以修改真实租户后，再显式执行：

```bash
node scripts/stage-acme-med-crm-write-tools.mjs --apply
```

`--apply` 会先备份目标租户的 `SKILL.md`、`tools.json` 和 `med_crm/cli.py`，再复制仓库内已验证的 skill package 文件。启用或重新应用后必须重启后端，让 `ToolRegistry` 重新扫描租户工具。
