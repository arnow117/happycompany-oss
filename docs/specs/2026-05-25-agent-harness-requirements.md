# Agent Harness 长任务执行与独立门禁需求

> 日期: 2026-05-25
> 状态: 草案
> 来源: 微信文章《让 AI 自己做增长：基于 OPC 和 Harness 思想的自主增长系统探索》
> 关联: [架构概览](./2026-05-21-architecture-overview.md), [Agent Dreaming v2](./2026-05-21-agent-dreaming-design.md), [业务 Skill Runner 与 MCP 边界收敛需求](./2026-05-25-business-skill-runner-requirements.md)

## 背景

HappyCompany 当前已经具备数字员工、handoff、ContractStore、SkillBridge、AuthGate、Scheduler、MessageStore 等基础能力。下一阶段问题不是“能否让员工回复消息”，而是：

- 一个真实业务长任务如何跨多个数字员工稳定执行？
- 如何知道子 Agent 是成功、失败、卡死还是只是没有确认？
- 如何防止生成型员工自己声明完成但实际没跑通？
- 如何把一次业务执行沉淀成可追踪、可复盘、可评审、可迭代的 contract tree？

参考文章提出的 Harness Engineering 思路适合转化为 HappyCompany 的新增需求：把长任务从一次聊天调用升级为**状态机驱动、产物门禁、独立评审、快速失败、可观测执行协议**。

## 目标

为 HappyCompany 增加一层 Agent Harness 能力，使数字员工可以执行长链路业务流程，并满足：

- 每个子任务有明确生命周期状态。
- 每个阶段有进入条件、产物要求、失败处理。
- 每个关键产物由独立 Evaluator 员工验收。
- 执行过程写入 contract / run / evaluation 记录。
- 长任务可超时、可重试、可人工接管。
- 评审员工本身可被 benchmark 和持续改进。

## 非目标

- 不替代现有 handoff 引擎。
- 不要求一次实现“全自动业务闭环”。
- 不允许取消人类关键确认节点。
- 不要求所有租户立刻启用该机制。
- 不把 Evaluator 变成自动修代码或自动改业务数据的执行者。

## 核心概念

### Agent Harness

Agent Harness 是围绕数字员工执行长任务的控制系统，负责状态、产物、门禁、重试、评审和审计。

它不直接代表某个员工，而是对员工执行进行约束：

```text
Business Trigger
  -> Workflow Run
  -> Step Run
  -> Employee Agent
  -> Artifacts
  -> Evaluator Gate
  -> Next Step / Retry / Escalate
```

### Workflow Run

一次业务长任务实例。例如：

- “客户签约后完成装机、开票、回款提醒”
- “根据客户需求生成报价方案并走经理审批”
- “发现业务机会后生成提案、PRD、设计、测试、实现、验收”

### Step Run

Workflow 中的单个阶段执行，由一个员工或子 Agent 负责。

### Evaluator Gate

独立验收节点。Evaluator 只判断产物是否通过，不直接修改产物。

## 状态模型需求

### R1. Step Run 生命周期

每个 Step Run 必须有明确状态：

```text
CREATED
  -> DISPATCHED
  -> ACKED
  -> RUNNING
  -> SUCCEEDED | FAILED | TIMED_OUT | STALLED | BLOCKED | CANCELLED
```

状态含义：

| 状态 | 含义 |
|---|---|
| CREATED | 已创建，尚未派发 |
| DISPATCHED | 已派发给目标员工 |
| ACKED | 目标员工确认接收 |
| RUNNING | 目标员工开始执行并进入心跳窗口 |
| SUCCEEDED | 执行成功且提交产物 |
| FAILED | 员工明确失败 |
| TIMED_OUT | 派发后未在规定时间 ACK |
| STALLED | 执行中超过进展/完成时限 |
| BLOCKED | 权限、风控、人工确认等阻断 |
| CANCELLED | 被人工或系统取消 |

### R2. 子任务协议参数

Harness 配置必须支持：

```jsonc
{
  "childRunProtocol": {
    "ackTimeoutSeconds": 300,
    "defaultStallTimeoutSeconds": 1200,
    "heartbeatIntervalSeconds": 60,
    "maxRetries": 2
  }
}
```

最低要求：

- 派发后超过 `ackTimeoutSeconds` 未 ACK，状态转为 `TIMED_OUT`。
- RUNNING 后超过 `defaultStallTimeoutSeconds` 未完成或无心跳，状态转为 `STALLED`。
- 每次状态变化写入 trace / contract store。
- 超时和卡死必须支持人工接管。

### R3. 心跳与进展记录

RUNNING 状态的子任务必须能记录：

- `lastHeartbeatAt`
- `progressSummary`
- `currentArtifact`
- `lastToolCall`
- `lastError`

心跳不是简单更新时间戳，必须包含可读的进展摘要，便于人类判断是否真正推进。

## Workflow 定义需求

### R4. Workflow Step Schema

Workflow step 至少包含：

```yaml
state: CONTRACT_REVIEWING
agent: contract_reviewer
condition: contract_status == ACTIVE
inputs:
  - contract.md
outputs:
  - evaluation.md
on_success: NEXT
on_failure: NEEDS_REVISION
timeout_seconds: 1200
evaluator: null
```

要求：

- `condition` 必须在派发前检查。
- `inputs` 必须存在或可从上游产物解析。
- `outputs` 必须在员工完成后检查。
- `on_failure` 必须明确，不允许无处理策略。

### R5. 进入条件检查

每个阶段进入前必须执行 condition check。

示例：

| 阶段 | 进入条件 |
|---|---|
| DESIGN_DEFINING | `prd_run_status == SUCCEEDED` |
| ARCH_DEFINING | `design_run_status == SUCCEEDED` |
| TESTCASE_DESIGNING | `contract_status == ACTIVE` |
| BUILDING | `testcase_run_status == SUCCEEDED` |
| EVALUATING | `build_run_status == SUCCEEDED` |

条件不满足时：

- 不派发子 Agent。
- Step 状态转为 `BLOCKED` 或指定 `on_failure`。
- 写入明确原因。

### R6. 产物门禁

每个 Step Run 必须声明产物。

产物类型包括：

- PRD
- UI/UX 设计规格
- 技术架构规格
- Sprint Contract
- 测试用例
- 代码变更摘要
- 验收报告
- 业务执行结果
- 人工确认记录

员工不能只返回“完成了”。必须提交对应 artifact，并由 Harness 检查存在性和基本结构。

## 独立评审需求

### R7. 生成与评审分离

任何关键产物不得由同一个员工自评通过。

规则：

- Builder 不得直接标记自己的实现通过。
- Product Agent 不得直接批准自己的 PRD。
- Design Agent 不得直接批准自己的设计。
- Evaluator 只输出评审结果和修改建议，不直接修改产物。

### R8. Evaluator 类型

平台应支持多类 Evaluator 员工：

| Evaluator | 评审对象 | 重点 |
|---|---|---|
| `prd_reviewer` | PRD | 需求完整性、成功指标、验收标准 |
| `design_reviewer` | UI/UX 设计 | 信息架构、交互完整性、视觉质量 |
| `arch_reviewer` | 技术架构 | 数据模型、API、边界、风险 |
| `contract_reviewer` | Sprint Contract | 范围、输入输出、验收标准 |
| `testcase_reviewer` | 测试用例 | 覆盖率、断言质量、边界条件 |
| `impl_reviewer` | 代码实现 | 构建、测试、E2E、架构合规 |
| `business_reviewer` | 业务动作 | 权限、数据一致性、人工确认 |

### R9. 零信任评审

Evaluator 必须自己验证，不接受上游声明。

最低要求：

- Builder 说测试通过，Evaluator 仍需读取或运行测试证据。
- 员工说已写入业务数据，Evaluator 仍需查询业务状态或 contract artifact。
- 服务启动、任务完成、文件生成等声明都必须有证据。

## 快速失败需求

### R10. Preflight 阶段

长任务执行前必须支持快速失败检查。

工程类任务建议顺序：

```text
1. 环境变量检查
2. 依赖可用性检查
3. 权限检查
4. 输入产物检查
5. 类型/构建检查
6. 静态分析
7. 动态验证
```

业务类任务建议顺序：

```text
1. 租户存在性检查
2. 员工存在性检查
3. skill 绑定检查
4. AuthGate 权限检查
5. 业务对象存在性检查
6. 写锁/人工确认检查
7. 实际执行
```

任何阻塞性 preflight 失败都必须提前终止，不进入高成本 Agent 调用。

### R11. 失败分类

失败必须分类，而不是统一 `FAILED`：

| 类型 | 例子 | 处理 |
|---|---|---|
| `PRECONDITION_FAILED` | 输入产物缺失 | 不重试，退回上游 |
| `AUTH_BLOCKED` | 权限不足 | 不重试，提示权限原因 |
| `ENV_MISSING` | 环境变量缺失 | 人工修复 |
| `TOOL_UNAVAILABLE` | CLI/MCP 不可用 | 可重试或人工修复 |
| `QUALITY_GATE_FAILED` | 评审不通过 | 回到修订阶段 |
| `TIMEOUT` | 未 ACK | 可重新派发 |
| `STALLED` | 长时间无进展 | 人工接管或重试 |
| `RISK_BLOCKED` | 风控阻断 | 人工审批 |

## Memory 与 Artifact 需求

### R12. 目录模型

每个 Workflow Run 应有可追踪 artifact 目录，建议结构：

```text
runs/{workflowRunId}/
├── workflow.yaml
├── decisions/
├── steps/
│   └── {stepId}/
│       ├── input.json
│       ├── output.md
│       ├── status.json
│       └── heartbeat.log
├── artifacts/
│   ├── prd.md
│   ├── design.md
│   ├── architecture.md
│   ├── contract.md
│   └── testcases.md
├── evaluations/
│   └── {gateId}/evaluation.md
└── final-report.md
```

### R13. ContractStore 关联

Artifact 文件和 ContractStore 记录必须互相可定位：

- ContractStore 记录 `workflowRunId`、`stepRunId`、`artifactPath`。
- Artifact 内记录 contract id / parent id。
- Handoff 形成 contract tree，而不是散落日志。

## Evaluator 元评估需求

### R14. Reviewer Benchmark

平台应支持对 Evaluator 进行离线 benchmark。

优先级：

1. `impl_reviewer`
2. `testcase_reviewer`
3. `prd_reviewer`
4. `arch_reviewer`
5. `design_reviewer`
6. `business_reviewer`

每个 benchmark 样本包含：

- 输入产物
- 标准答案
- 应发现问题列表
- 不应误报列表
- 严重程度
- 期望结论

### R15. 评分指标

Evaluator benchmark 至少记录：

| 指标 | 含义 |
|---|---|
| 检出率 | 应发现问题找到了多少 |
| 精确率 | 报告的问题中有多少是真的 |
| 严重程度准确率 | P0/P1/P2 分级是否正确 |
| 误报数 | 对好样本错误挑刺数量 |
| 结论校准度 | PASS/NEEDS_REVISION/BLOCKED 是否准确 |
| 报告可操作性 | 是否能指导修复 |

门禁要求：

- 未通过 benchmark 阈值的 Evaluator 不得作为生产强门禁。
- 可以作为 advisory reviewer 输出建议。

## 人工介入需求

### R16. Human-in-the-loop

以下场景必须支持人工介入：

- `RISK_BLOCKED`
- 对外写入高风险业务数据
- 线上部署
- 合同/财务/发票等关键动作
- 连续重试仍失败
- Evaluator 与 Builder 结论冲突

人工介入记录必须成为 artifact，不得只停留在聊天消息里。

### R17. “无人干预”定义

系统文案和产品设计不应承诺 100% 无人干预。

推荐定位：

> 降低人工干预频率，让一个人可监护多个并行 Agent 工作流；人在关键节点做判断，Agent 负责高频执行和自检。

## 可观测性需求

### R18. Harness Dashboard

Web 层应能展示：

- active workflow runs
- stuck / timed out runs
- step 状态分布
- 最近失败原因
- evaluator gate 通过率
- 平均 ACK 时间
- 平均执行时间
- retry 次数

### R19. Run Timeline

单个 Workflow Run 页面应展示：

```text
trigger -> decision -> dispatch -> ack -> running -> artifact -> evaluation -> next step
```

每个节点能展开：

- 员工
- 输入
- 输出
- 工具调用摘要
- 权限校验
- 评审结论
- 错误原因

## 验收场景

### A1. 子任务 ACK 超时

给某员工派发任务后不启动 Agent 或模拟无 ACK。

预期：

- 300 秒后 Step Run 转为 `TIMED_OUT`。
- ContractStore 有状态变化记录。
- Dashboard 显示超时。
- 不进入后续 step。

### A2. RUNNING 卡死

模拟 Agent ACK 后进入 RUNNING，但不产出心跳或不完成。

预期：

- 超过 stall timeout 后转为 `STALLED`。
- 可人工接管或重新派发。
- 原执行记录保留。

### A3. 条件不满足不派发

`DESIGN_DEFINING` 依赖 PRD 成功，但 PRD 产物不存在。

预期：

- DESIGN step 不派发。
- 状态为 `BLOCKED` 或指定 on_failure。
- 错误原因指向缺失产物。

### A4. Builder 声称完成但缺产物

Builder 返回“已完成”，但未提交 contract 声明的 artifact。

预期：

- Harness 判定 `QUALITY_GATE_FAILED`。
- 不进入 evaluator。
- 返回缺失 artifact 列表。

### A5. Evaluator 独立验证

Builder 提交实现并声明测试通过。

预期：

- `impl_reviewer` 重新运行或读取测试证据。
- 没有证据时不能 PASS。
- 评审报告进入 `evaluations/`。

### A6. 快速失败拦截环境缺失

工程类 workflow 缺少必要环境变量。

预期：

- preflight 在 Agent 调用前失败。
- 不消耗 Builder 轮次。
- 返回 `ENV_MISSING`。

### A7. 业务权限快速失败

销售员工尝试执行财务写入。

预期：

- Skill Runner / AuthGate 在执行前拒绝。
- 状态为 `AUTH_BLOCKED`。
- 不调用业务 CLI/server。

### A8. Evaluator Benchmark

运行一组包含 good/bad example 的 `impl_reviewer` benchmark。

预期：

- 输出检出率、精确率、误报数、结论校准度。
- 低于阈值时不能启用生产强门禁。

## 实现分期建议

### Phase 1. Run Protocol 最小闭环

- 引入 Step Run 状态模型。
- 支持 DISPATCHED / ACKED / RUNNING / SUCCEEDED / FAILED / TIMED_OUT / STALLED。
- 写入 ContractStore / trace-store。
- 增加超时轮询。

### Phase 2. Artifact Gate

- 为 workflow step 增加 inputs / outputs / condition。
- 完成产物存在性检查。
- 缺失产物不进入后续 step。

### Phase 3. Evaluator Gate

- 支持 evaluator employee。
- 实现生成/评审分离。
- 评审结果写入 evaluations。

### Phase 4. Preflight + 快速失败

- 工程任务 preflight。
- 业务任务 preflight。
- 失败分类标准化。

### Phase 5. Reviewer Benchmark

- 先做 `impl_reviewer` benchmark。
- 再扩展到 PRD / Arch / Design / Business reviewer。

### Phase 6. Web 可观测性

- Workflow Run 列表。
- Run Timeline。
- Stalled / Timed out 视图。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 过早全自动化 | 长链路节点多，端到端成功率会快速下降 | 分期启用，保留人工接管 |
| Evaluator 误判 | 评审员工本身也会漏报/误报 | 引入 benchmark 和 advisory/strong gate 分级 |
| 状态机复杂度上升 | 引入更多状态和失败路径 | 先做最小协议，不一次性覆盖所有 workflow |
| Artifact 目录膨胀 | 长任务产物多 | 定义归档和清理策略 |
| 与现有 handoff 重叠 | handoff 已有 contract chain | Harness 复用 contract，不重复造链路 |

## 开放问题

- Workflow 定义应该放在 `corp/{tenant}/workflows/`，还是平台级 templates？
- Evaluator 员工是租户内可配置，还是平台内置？
- Artifact 存储先用文件系统，还是进入 SQLite metadata + 文件混合？
- Web Dashboard 是否复用现有 Orchestration 页面？
- 生产强门禁阈值应如何定义？
