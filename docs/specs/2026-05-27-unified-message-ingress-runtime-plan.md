# Unified Message Ingress Runtime + Harness Adapter Plan

> 日期: 2026-05-27
> 状态: 草案
> 关联:
> - [架构概览](./2026-05-21-architecture-overview.md)
> - [Agent Harness 长任务执行与独立门禁需求](./2026-05-25-agent-harness-requirements.md)
> - [Agent Dreaming v2](./2026-05-21-agent-dreaming-design.md)
> - [ADR-003 Dispatcher as Router](../adr/2026-05-21-003-dispatcher-as-router-fork-instances.md)

**更新**: 2026-05-30 — Harness real mode 采用“连接运行中的后端服务”而不是在 CLI 内重启整个平台。后端提供 admin-only harness run endpoint，CLI 负责提交 YAML case；真实 `agentFactory`、人员绑定、权限、MCP 注入仍由主服务持有。

## 1. 背景

HappyCompany 已经有 Web Chat、钉钉、飞书、数字员工路由、人员绑定、SkillRunner、Memory、Handoff 和 Trace。下一步需要的是一套可重复验收的平台级 Harness。

但 Harness 不应该另起一套聊天逻辑。否则会出现：

- Web Chat 测通了，但钉钉链路没通。
- Harness 测通了，但 Web 链路没通。
- 路由、人员绑定、memory、handoff 在不同入口之间行为漂移。

因此本计划把目标调整为：

> 先抽出统一 Message Ingress Runtime，让 Web/钉钉/飞书/Harness 都调用同一套后端消息运行时。

Harness 是这个 Runtime 的测试 adapter，不是独立业务入口。

## 2. 当前现状

当前消息入口大致分裂为两条：

| 入口 | 当前路径 | 问题 |
|---|---|---|
| Web Chat | `src/ws.ts` 解析 WebSocket 消息，直接写 MessageStore，然后调用 `agentFactory.respond()` | Web 层承担了部分消息生命周期逻辑；不容易输出结构化验收 trace |
| 钉钉/飞书 | `BotManager.handleMessage()` 负责 shouldRespond、reaction、存储、附件解析、streaming，然后调用 `agentFactory.respond()` | IM 和 Web 的消息存储、流式事件、错误处理不完全一致 |
| 共同核心 | `src/index.ts` 内部的 `agentFactory.respond()` | 包含 employee-director、人员绑定、selector、orchestrator、MCP 注入、AuthGate、knowledge 等关键逻辑，但不是独立可测试模块 |
| 长任务 Harness | `docs/specs/2026-05-25-agent-harness-requirements.md` | 需求偏长任务状态机，尚未有可运行 adapter |

当前最关键的共享逻辑在 `agentFactory.respond()`，但它被定义在 `src/index.ts` 的闭包里，外部不容易作为稳定测试对象调用，也不方便输出结构化执行过程。

## 3. 目标

新增一个统一消息入口运行时：

```text
Channel Adapter
  Web Chat / DingTalk / Feishu / Harness
        ↓
MessageIngressRuntime.handle()
        ↓
MessageStore + Routing + Employee Agent + SkillRunner + Memory + Handoff
        ↓
Reply + Stream Events + Ingress Trace
```

目标：

- Web Chat 和 IM 入口尽可能共享同一条后端处理链路。
- Harness 只模拟入口输入，不绕过路由、绑定、权限、memory、handoff。
- 每次消息处理都能产出结构化 `IngressTrace`，用于断言和回归测试。
- 不改变现有用户体验，先做行为等价抽取。

## 4. 非目标

- 不在第一阶段实现长任务 Step Run 状态机。
- 不替代现有 `OrchestratorRunner`。
- 不重做钉钉/飞书 channel adapter。
- 不把 Harness 做成新的聊天 UI。
- 不在第一阶段做 dreaming 自动挖掘；但输出 trace 要能被后续 dreaming 复用。

## 5. 核心设计

### 5.1 MessageIngressRuntime

新增模块建议：

```text
src/ingress/
├── types.ts              # 输入、输出、trace、事件类型
├── runtime.ts            # MessageIngressRuntime.handle()
├── trace-recorder.ts     # 统一收集 route/tool/memory/handoff/error
├── adapters/
│   └── harness.ts        # Harness adapter 的纯逻辑封装
└── index.ts
```

核心接口草案：

```ts
type IngressChannel = 'web' | 'dingtalk' | 'feishu' | 'harness';

interface IngressMessageInput {
  channel: IngressChannel;
  botName: string;
  tenant?: string;
  userId?: string;
  chatId: string;
  messageId?: string;
  text: string;
  files?: NormalizedMessage['files'];
  attachments?: Array<{ data: string; mimeType: string }>;
  receivedAt?: number;
}

interface IngressCallbacks {
  onText?: (text: string) => void;
  onToolStart?: (info: { toolName: string; toolUseId: string; toolInput?: Record<string, unknown> }) => void;
  onToolEnd?: (info: { toolName: string; toolUseId: string; elapsedMs: number }) => void;
}

interface IngressResult {
  reply: string;
  trace: IngressTrace;
}
```

### 5.2 IngressTrace

Harness 的价值来自结构化 trace，而不是只看最终回复。

```ts
interface IngressTrace {
  input: {
    channel: IngressChannel;
    botName: string;
    tenant?: string;
    userId?: string;
    chatId: string;
  };
  routing: {
    mode?: string;
    selectedEmployee?: string;
    boundEmployee?: string;
    selectorShown?: boolean;
  };
  agent: {
    id: string;
    cwd?: string;
    workspace?: string;
  };
  toolCalls: Array<{
    name: string;
    status: 'running' | 'complete' | 'error';
    elapsedMs?: number;
  }>;
  memory: Array<{
    operation: 'append' | 'search' | 'read' | 'write';
    subject: string;
    workspace?: string;
    status: 'ok' | 'error';
  }>;
  handoffs: Array<{
    from: string;
    to: string;
    reason?: string;
  }>;
  errors: Array<{ stage: string; message: string }>;
  startedAt: number;
  finishedAt?: number;
}
```

第一版不要求所有字段都完整，但接口必须先稳定下来。

### 5.3 Adapter 职责边界

Adapter 只处理通道差异，不承载平台路由规则。

**更新 2026-06-02**: Web 流式协议已由 `stream_delta` / `stream_done` 迁移为后端权威的 `new_message` + `stream_event` + `stream_snapshot`。旧协议不再保留兼容路径；详见 `2026-06-02-web-im-streaming-alignment-test-plan.md`。

| Adapter | 保留职责 | 不应承担 |
|---|---|---|
| Web | WebSocket 协议、`new_message` / `stream_event` / `stream_snapshot` 广播、用户取消 | 人员绑定、员工选择、memory 写入 |
| 钉钉 | 消息解析、@ 判断、reaction、卡片 streaming、附件下载 | 数字员工路由、SkillRunner 权限 |
| 飞书 | 同上 | 同上 |
| Harness | 读取 case、调用 Runtime、断言 trace | 独立实现路由或 mock 员工行为 |

## 6. 分阶段计划

### Phase 0: 现状冻结与安全边界

目标：避免在大量未提交改动上直接重构。

工作：

- 确认当前模板/部署相关改动由另一个 session 管理。
- 本计划实现时单独开分支或先清理工作区。
- 不修改 `corp/templates/industries/...` 这类正在变化的模板数据。

验收：

- 新增 plan/spec 不混入业务模板改动。

### Phase 1: 定义类型与 TraceRecorder

目标：先加结构，不改行为。

工作：

- 新增 `src/ingress/types.ts`。
- 新增 `src/ingress/trace-recorder.ts`。
- TraceRecorder 支持记录：
  - routing decision
  - tool start/end
  - memory operation
  - handoff
  - error
- 单元测试覆盖 trace 合并和错误记录。

验收：

- `npx vitest run tests/ingress/trace-recorder.test.ts`
- 不改变 Web/IM 行为。

### Phase 2: 抽出 MessageIngressRuntime

目标：把 Web 和 IM 共同需要的消息生命周期收进 Runtime。

工作：

- 新增 `src/ingress/runtime.ts`。
- Runtime 负责：
  - 写入用户消息到 MessageStore
  - 构造带附件的 prompt
  - 调用共享 agent runtime
  - 写入 bot 回复到 MessageStore
  - 发布 bus 事件
  - 返回 `IngressResult`
- 把 `agentFactory.respond()` 从 `src/index.ts` 内部闭包逐步迁出为可注入依赖，或先以接口方式包一层：

```ts
interface AgentRuntime {
  respond(prompt: string, chatId: string, botName: string, opts: RespondOptions): Promise<string>;
}
```

验收：

- Runtime 单元测试用 fake AgentRuntime 验证存储、bus、trace。
- 现有 `agentFactory.respond()` 行为不变。

### Phase 3: Web Chat 切换到 Runtime

目标：Web 入口成为统一 Runtime 的第一个真实 adapter。

工作：

- `src/ws.ts` 保留 WebSocket 协议处理和 pending abort。
- `chat` 消息调用 `MessageIngressRuntime.handle()`。
- Web adapter 不再输出 `stream_delta` / `stream_done`；`MessageIngressRuntime` 发布 `stream_event` 和 `new_message`，WebSocket 负责广播与恢复快照。
- 移除 Web 层重复的 MessageStore 写入逻辑。

验收：

- Web Chat 仍可正常发送、流式回复、取消。
- Web Chat 消息仍进入 MessageStore。
- `web/src/stores/chat.ts` 无需理解 Runtime 内部结构。

### Phase 4: IM 入口切换到 Runtime

目标：钉钉/飞书和 Web 共享同一套消息生命周期。

工作：

- `BotManager.handleMessage()` 保留：
  - shouldRespond
  - reaction
  - channel sendStreaming
  - channel-specific file download
- 其余消息处理切换为 Runtime：
  - store user
  - call agent
  - store reply
  - publish bus
  - record trace
- tool status 回调继续透传给 IM streaming card。

验收：

- 钉钉/飞书原有消息链路测试通过。
- Web 和 IM 的 MessageStore 记录格式一致。
- `agent_reply_sent`、`message_received` bus 事件一致。

### Phase 5: Harness Adapter MVP

目标：在统一 Runtime 上加测试入口，而不是新聊天逻辑。

建议新增：

```text
src/ingress/adapters/harness.ts
scripts/harness.mjs 或 src/harness-cli.ts
tests/ingress/harness.test.ts
```

Case 格式草案：

```yaml
id: sales-user-routes-to-sales
input:
  channel: harness
  tenant: acme
  botName: acme-dingtalk
  userId: demo-user-001
  chatId: harness-sales-001
  text: 查一下浙一医院相关维保合同
expect:
  routedEmployee: sales-zhangsan
  memoryWorkspace: corp/acme/agents/sales-zhangsan/memory
  toolNames:
    - med_crm:global_search
  replyContains:
    - 维保
```

CLI 草案：

```bash
npx tsx src/harness-cli.ts --case tests/fixtures/harness/sales-user-routes-to-sales.yaml
npx tsx src/harness-cli.ts --suite tests/fixtures/harness
```

真实链路模式不在 CLI 内 bootstrap `src/index.ts`。CLI 默认连接运行中的后端：

```bash
npm run dev
npx tsx src/harness-cli.ts --case tests/fixtures/harness/sales-user-routes-to-sales.yaml \
  --server-url http://127.0.0.1:3100 \
  --admin-token "$HAPPYCOMPANY_ADMIN_TOKEN"
```

原因：生产 `agentFactory` 仍由 `src/index.ts` 闭包持有，里面包含当前配置、员工实例、AuthGate、MCP 注入、scheduler 等运行态依赖。Harness real mode 通过后端 endpoint 复用这份运行态，避免 CLI 复制一套启动逻辑。

第一版断言：

- routed employee
- selector shown / not shown
- final reply contains
- tool calls includes
- memory workspace
- handoff count
- no unexpected error

### Phase 6: 需求验收用例

第一批用例建议：

| 用例 | 输入 | 预期 |
|---|---|---|
| bound-user-default-employee | 已绑定用户发业务问题 | 路由到绑定员工 |
| selector-visible-employees | selector 模式用户无当前选择 | 返回员工选择列表 |
| selector-command-selects-employee | 用户回复编号或 slash 选择员工 | 持久化选择并提示继续提问 |
| sales-query-uses-med-crm | 销售问题 | 进入销售员工，允许 med_crm read 工具 |
| memory-scoped-to-employee | 员工调用 memory_append | 写入员工 workspace |
| handoff-records-trace | 销售任务 handoff 到服务/财务 | trace 中出现 handoff route |
| unbound-user-blocked | 未绑定且无可见员工 | 返回绑定提示 |

### Phase 7: 与长任务 Harness 对接

统一 Runtime 完成后，再回到 `2026-05-25-agent-harness-requirements.md`：

- Step Run 可以通过 Runtime 派发给员工。
- Evaluator Gate 可以复用 Harness adapter 的 trace 断言机制。
- 长任务状态机只负责 run/step/evaluation，不再关心 Web/IM/Harness 通道差异。

## 7. 测试策略

### 单元测试

- `TraceRecorder` 事件记录。
- `MessageIngressRuntime` 用 fake AgentRuntime 验证：
  - user message 写入
  - reply 写入
  - bus event 发布
  - stream callback 透传
  - error trace 记录

### 集成测试

- WebSocket chat 通过 Runtime 后仍能发送/接收。
- BotManager chat 通过 Runtime 后仍能处理 IM normalized message。
- employee-director selector 和 entry routing 行为保持一致。

### Harness 用例测试

- 跑 fixture suite。
- 对 `IngressTrace` 做结构化断言。
- 失败时输出 JSON，便于定位：

```json
{
  "case": "sales-query-uses-med-crm",
  "status": "failed",
  "failedExpectation": "toolNames includes med_crm:global_search",
  "trace": {}
}
```

### E2E

- Web Chat smoke test：真实 WebSocket 发消息。
- 后续再补钉钉/飞书实机 smoke，不作为第一阶段 CI 门槛。

## 8. Done 标准

第一阶段完成标准：

- Web Chat 和 BotManager 都调用统一 Runtime。
- Harness CLI 能跑至少 3 条 fixture。
- 每条 Harness case 输出 `IngressTrace`。
- 现有 Web/IM 行为无明显回归。
- Memory 和 employee workspace 的断言可自动验证。
- 新增测试命令写入 test plan 或 operations 文档。

## 9. 风险与处理

| 风险 | 处理 |
|---|---|
| `agentFactory.respond()` 当前闭包依赖太多 | 先定义 `AgentRuntime` 接口包一层，后续再逐步迁出 |
| Web 和 IM streaming 语义不同 | Runtime 只暴露 callback，adapter 决定怎么渲染 |
| Harness 断言依赖真实 LLM 不稳定 | 第一版允许 fake AgentRuntime；真实 LLM 用 smoke suite，不做强 CI |
| trace 字段一开始不完整 | 接口先稳定，字段逐步补齐 |
| 与长任务 Harness 概念混淆 | 本文只做 message ingress；长任务状态机在后续 plan 中实现 |

## 10. 建议实施顺序

建议先做小闭环：

1. `TraceRecorder`
2. `MessageIngressRuntime` + fake AgentRuntime 测试
3. WebSocket adapter 切 Runtime
4. Harness adapter + 3 条 fixture
5. BotManager 切 Runtime
6. 再扩展长任务 Harness

这个顺序的好处是：先让 Web Chat 和 Harness 贴近，再把 IM 拉进来；每一步都有可回滚边界。
