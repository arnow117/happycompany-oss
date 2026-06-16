# ADR-004: Runtime Profile 统一入口、会话、Builder 与多员工工作流

**日期**: 2026-06-02
**状态**: 草案
**关联**:
- [ADR-002 数字员工 Demo 与自生成架构](./2026-05-11-002-digital-employee-demo.md)
- [ADR-003 调度员退化为路由层 + 数字员工实例化](./2026-05-21-003-dispatcher-as-router-fork-instances.md)
- [统一消息入口 Runtime 计划](../specs/2026-05-27-unified-message-ingress-runtime-plan.md)
- [Agent Builder Requirements](../specs/2026-05-31-agent-builder-requirements.md)

## 背景

当前 HappyCompany 已经具备数字员工 YAML、Web/IM 入口、企业人员绑定、统一 `MessageIngressRuntime`、Agent Builder 草稿、Harness、handoff 等能力，但核心数据模型分散：

- Chat 页面主要通过 `/api/workdirs` 选择可聊对象。
- Sessions 页面主要按 config bot 读取 `/api/admin/bots/:name/sessions`。
- Digital Employees 页面读取企业员工 YAML / 模板。
- Agent Builder 使用 `AgentDraft`，但沙盒测试仍是 fake harness trace。
- `messages.db` 以 `bot_name + chat_id` 为主，缺少 tenant、entry、actor、employee、runtime instance 维度。
- SDK session 文件位于 agent workdir 下，但业务会话索引没有明确指向 workdir 和 SDK session scope。

这些分叉导致 Web、IM、Sessions、Builder 和多员工协作看到的“同一个数字员工”并不总是同一个运行实例。

## 决策

引入 `RuntimeProfile` 作为数字员工运行时的唯一事实来源，并把入口、使用者、员工定义、运行实例、会话和工作流显式建模。

核心关系：

```text
Tenant
  -> EntryEndpoint
  -> ActorIdentity
  -> RuntimeTarget
  -> RuntimeInstance
  -> ConversationSession
  -> RuntimeProfile
```

Builder 生产 `RuntimeProfileDraft`，发布后生成 `RuntimeProfile`。Web、IM、Harness、Builder 沙盒和多员工工作流都通过同一个 Runtime Resolver 进入 `MessageIngressRuntime`。

## 核心数据结构

### 1. Tenant

企业租户仍以 `corp/{tenant}` 为物理边界。

```ts
interface TenantRef {
  tenant: string;
  appName?: string;
}
```

### 2. EntryEndpoint

入口是渠道接入点，不是业务员工。

```ts
type EntryChannel = 'web' | 'dingtalk' | 'feishu' | 'harness' | 'builder_sandbox';

interface EntryEndpoint {
  id: string;
  tenant: string;
  channel: EntryChannel;
  displayName: string;
  routingMode: 'direct' | 'employee-director' | 'workflow';
  enabled: boolean;
  configRef?: string;
}
```

说明：

- 旧 `BotConfig` 中面向渠道的字段收敛为 `EntryEndpoint`。
- `entry-bot`、`im-bot` 不再作为核心 kind；它们只是不同 channel 的 entry。
- `employee` 是真正执行业务的数字员工定义。

### 3. ActorIdentity

Actor 表示“这条消息代表谁发出”。

```ts
interface ActorIdentity {
  tenant: string;
  actorId: string;
  source: 'people' | 'platform_user' | 'web_impersonation' | 'anonymous' | 'harness';
  displayName?: string;
  peopleUserId?: string;
  platformUserId?: string;
  bindings: Array<{
    employeeId: string;
    role?: string;
    isDefault?: boolean;
  }>;
}
```

说明：

- IM 按平台 openId/unionId 映射到 `people.json` 绑定。
- Web 日常使用允许选择一个企业人员作为 `web_impersonation`，用来代入不同角色和人测试路由。
- 未绑定用户不创建业务员工会话，返回绑定提示或选择器。

### 4. EmployeeDefinition

`corp/{tenant}/employees/{employeeId}.yaml` 继续作为已发布员工定义。

```ts
interface EmployeeDefinition {
  id: string;
  displayName: string;
  description: string;
  role: string;
  systemPrompt: string;
  skills: string[];
  tools: string[];
  allowedTargets: string[];
  capabilities: string[];
  workspace: string;
  humanUserId?: string;
}
```

说明：

- `workspace` 是员工定义里的工作区声明，来自 YAML，通常是租户内相对路径，例如 `agents/sales-zhangsan`。
- `workspace` 表达“这个员工默认应该从哪里派生/落盘工作区”，不是每次运行直接传给 Agent SDK 的最终 cwd。
- 后续类型实现时可以把运行时内部字段命名为 `workspaceRef` 或 `workspaceTemplate`，但 YAML 字段暂时保留 `workspace` 以兼容现有 employee 文件。

### 5. RuntimeInstance

RuntimeInstance 是一次消息最终执行的“员工实例”。

```ts
interface RuntimeInstance {
  tenant: string;
  employeeId: string;
  actorId: string;
  instanceId: string;
  workdir: string;
  sdkSessionScope: string;
  source: 'published_employee' | 'draft_overlay';
}
```

说明：

- `employeeId` 是员工定义。
- `actorId` 是这次代入的人或真实 IM 用户。
- `instanceId` 用于隔离同一员工被不同人使用时的 workdir/session。
- `workdir` 是由 `tenant + employee.workspace + actorId/instanceId` 解析出的实际目录，是 Claude Agent SDK 的 cwd。
- SDK session 文件仍在 workdir 内，但业务会话必须保存 `workdir` 和 `sdkSessionScope`。

### 5.1 运行隔离策略

运行隔离由 Runtime Resolver 统一计算。前端、IM adapter、Builder 页面和 Harness case 都不能直接传入最终 `workdir`。

Harness 的 fake/offline fixture 可以携带 `runtime.resolved` 快照，用于不启动真实企业目录时验证 trace 和断言语义；真实服务端 Harness 必须忽略该 fallback，仍通过 Runtime Resolver 计算 `workdir` 和 `sdkSessionScope`。

默认隔离键：

```text
isolationKey = tenant + entryId + actorId + employeeId + sessionScope
```

各层使用不同粒度：

| 资源 | 默认粒度 | 用途 |
| --- | --- | --- |
| `RuntimeInstance.instanceId` | `tenant + actorId + employeeId` | 隔离同一员工定义被不同人使用时的实例 |
| `RuntimeInstance.workdir` | `tenant + employee.workspace + actorId/instanceId` | Claude Agent SDK cwd、文件和本地工作区 |
| `ConversationSession.id` | `tenant + entryId + actorId + employeeId + chatId` | 业务会话归档和消息查询 |
| `sdkSessionScope` | `tenant + entryId + actorId + employeeId + chatId` | Claude SDK resume session 隔离 |
| memory namespace | `tenant + actorId + employeeId` | 某个人的某个数字员工长期记忆 |
| builder sandbox scope | `tenant + draftId + actorId + chatId` | 草稿测试隔离，不污染正式员工 |
| workflow scope | `tenant + workflowThreadId` | 多员工群聊式业务线程 |

示例：

```text
tenant: acme-happycompany
entryId: web-bot
actorId: user-sales-a
employeeId: sales-zhangsan
chatId: web-chat-001

workdir:
corp/acme-happycompany/agents/sales-zhangsan/user-sales-a

sdkSessionScope:
acme-happycompany:web-bot:user-sales-a:sales-zhangsan:web-chat-001

memory namespace:
acme-happycompany:user-sales-a:sales-zhangsan
```

这意味着：

- 租户隔离靠 `tenant` 和租户目录边界。
- 人员隔离靠 `actorId`。
- 员工隔离靠 `employeeId`。
- 会话隔离靠 `chatId` / `sdkSessionScope`。
- Web / IM 入口隔离靠 `entryId`。
- Builder 草稿隔离靠 `draftId` 和 `mode=builder_sandbox`。
- Workflow 隔离靠 `workflowThreadId`。

### 6. RuntimeProfile

RuntimeProfile 是执行前组装出的完整运行配置。

```ts
interface RuntimeProfile {
  tenant: string;
  entry: EntryEndpoint;
  actor: ActorIdentity;
  employee: EmployeeDefinition;
  instance: RuntimeInstance;
  instructions: {
    systemPrompt: string;
    claudeMdPath?: string;
    rules: string[];
    handoffConditions: string[];
  };
  tools: {
    allowed: string[];
    denied: string[];
    riskWarnings: string[];
  };
  skills: string[];
  memory: {
    namespace: string;
    workdir: string;
  };
}
```

`MessageIngressRuntime` 只接受已解析的 RuntimeProfile 或可解析的 `RuntimeMessageInput`，不再让各入口自己猜 bot、workdir、tenant 和 employee。

### 7. ConversationSession

业务会话集中存储，不再只按 config bot 或 workdir 推断。

```ts
interface ConversationSession {
  id: string;
  tenant: string;
  entryId: string;
  channel: EntryChannel;
  actorId: string;
  chatId: string;
  employeeId: string;
  instanceId: string;
  workdir: string;
  sdkSessionScope: string;
  mode: 'single_employee' | 'workflow_group' | 'builder_sandbox';
  title?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}
```

Messages 关联 `session.id`，并保留 `tenant / entryId / actorId / employeeId / instanceId` 作为查询索引。

会话归档只更新业务索引的 `archivedAt`，默认列表隐藏已归档会话，但不删除 `messages`、workdir 内的 SDK session 文件或员工运行产物。恢复、硬删除和 SDK session 清理作为后续显式运维能力处理。

### 8. RuntimeProfileDraft

Builder 草稿从 `AgentDraft.employee` 升级为 `RuntimeProfileDraft`。

```ts
interface RuntimeProfileDraft {
  id: string;
  tenant: string;
  source: 'natural_language' | 'template' | 'fork' | 'manual';
  status: 'draft' | 'validated' | 'sandboxed' | 'published';
  profile: Omit<RuntimeProfile, 'entry' | 'actor' | 'instance'> & {
    testActors: ActorIdentity[];
    sandboxEntry: EntryEndpoint;
  };
  validation: {
    ok: boolean;
    issues: AgentBuilderIssue[];
  };
  sandboxRuns: Array<{
    sessionId: string;
    result: 'passed' | 'failed' | 'error';
    traceId?: string;
  }>;
}
```

Builder 沙盒必须走真实 `MessageIngressRuntime`，允许使用 draft overlay，但不允许写入正式 employee YAML。

### 9. WorkflowThread

多员工群聊式工作流是会话的一种模式，不是独立入口。

```ts
interface WorkflowThread {
  id: string;
  tenant: string;
  parentSessionId: string;
  entryId: string;
  actorId: string;
  participants: Array<{
    employeeId: string;
    instanceId: string;
    role: 'owner' | 'participant' | 'observer';
  }>;
  state: 'open' | 'waiting' | 'completed' | 'cancelled';
  handoffs: Array<{
    fromEmployeeId: string;
    toEmployeeId: string;
    reason?: string;
    status: 'requested' | 'accepted' | 'completed' | 'failed';
    at: number;
  }>;
}
```

handoff 在群聊工作流中表现为“把目标员工拉入同一业务线程并推进任务”，而不是把用户从一个单聊彻底切走。

## 核心 API

### Runtime Directory

```text
GET /api/runtime/entries?tenant=...
GET /api/runtime/actors?tenant=...&entryId=...
GET /api/runtime/targets?tenant=...&entryId=...&actorId=...
```

用途：

- Web Chat 加载可代入人员、默认绑定员工、可选入口。
- Sessions 页面按同一模型列出会话。
- IM 管理页查看入口与绑定状态。

### Runtime Message

```text
POST /api/runtime/messages
WS send_message
```

统一输入：

```ts
interface RuntimeMessageInput {
  tenant: string;
  entryId: string;
  channel: EntryChannel;
  actorId: string;
  chatId: string;
  text: string;
  attachments?: IngressAttachment[];
  target?: {
    employeeId?: string;
    workflowThreadId?: string;
    draftId?: string;
  };
}
```

Web 和 IM 的区别只在 actor 解析：

- Web：用户可选择 `ActorIdentity`，用于代入企业不同人员和角色。
- IM：通过平台用户身份解析 `ActorIdentity`，默认按已有绑定路由。

### Sessions

```text
GET /api/runtime/sessions?tenant=...&entryId=...&actorId=...
GET /api/runtime/sessions/:id
PATCH /api/runtime/sessions/:id
```

旧 `/api/admin/bots/:name/sessions` 退化为兼容或移除，不再作为 Sessions 页事实来源。

### Builder

```text
POST /api/agent-builder/drafts
GET /api/agent-builder/drafts/:id
PUT /api/agent-builder/drafts/:id
POST /api/agent-builder/drafts/:id/validate
POST /api/agent-builder/drafts/:id/sandbox/messages
POST /api/agent-builder/drafts/:id/publish
```

`sandbox/messages` 走真实 Runtime，生成 `mode=builder_sandbox` 的 session 和 trace。

### Workflow

```text
POST /api/runtime/workflows
GET /api/runtime/workflows/:id
POST /api/runtime/workflows/:id/messages
POST /api/runtime/workflows/:id/handoff
```

Workflow message 同样进入 `MessageIngressRuntime`，但 trace 中记录多个 participant 的执行与 handoff。

阶段性交付中先落地 `WorkflowThread` 事实源、`workflow_group` session、handoff 事件 API、最小 workflow message 执行和 `/orchestration` 里的 Workflow Threads 工作台。该工作台支持从 Runtime Directory 创建 workflow、查看 participants/handoff、手动添加 handoff、向 participant 发送 workflow message；thread summary memory、自动 handoff 回写和完整群聊时间线在后续阶段接入。

## Web / IM 行为

### Web 日常使用

Web Chat 首屏需要先确定：

1. tenant
2. entry
3. actor/person
4. session

然后由 Runtime Resolver 找到默认绑定员工或展示选择器。Web 可以代入不同企业人员，用于运营、调试和真实客服场景。

### IM 日常使用

IM 不展示选择器，默认：

1. channel adapter 解析平台用户身份。
2. Runtime Resolver 查 `people.json` 绑定。
3. 找到绑定员工则进入对应 RuntimeInstance。
4. 未绑定则返回绑定提示。

### Sessions 页面

Sessions 页面按 `ConversationSession` 查询，不再按 config bot 查询。用户能看到：

- 哪个 tenant / entry
- 哪个 actor
- 路由到哪个 employee
- workdir 和 SDK session scope
- 单员工会话还是 workflow group

## Web 平台产品收口

Runtime Profile 统一后，Web 平台以业务对象为主导航，工程对象退到详情里。

核心产品关系：

```text
Tenant -> Entry -> Actor -> Session -> Employee / Workflow
```

### Chat

Chat 从“选择 workdir / agent”收口为：

- 普通用户：选择企业和入口后，默认代表自己，按绑定员工路由。
- 管理员 / 授权运营：可以代入权限范围内的企业人员，观察路由结果、会话、工具调用和 workdir。
- 未绑定 actor：展示绑定提示或员工选择器，不吞消息。

`workdir` 不再作为 Chat 主选择项，只在运行详情、trace 或 session detail 中展示。

### Sessions

Sessions 成为统一会话中心，不再按 config bot 查询。筛选维度改为：

- tenant
- entry / channel
- actor
- employee
- mode: `single_employee` / `workflow_group` / `builder_sandbox`
- 时间、状态、归档状态

Chat 和 Sessions 必须看到同一套会话数据。

### Employees

Employees 页面聚焦已发布数字员工：

- 员工列表和详情。
- 人员绑定。
- 能力、工具、风险、版本、运行状态。
- 从已发布员工 fork 到 Builder。

自然语言生成、结构化编辑、沙盒测试和发布动作迁移到 Builder。

### Builder

Builder 是数字员工生产线：

- 对话式组装 `RuntimeProfileDraft`。
- 编辑基础设置、角色、沟通风格、条件遵循、转人工条件。
- 配置 skills、tools、tool request/response mapping。
- 使用真实 Runtime 沙盒测试。
- 发布为正式 employee YAML 和 workspace。

### Workflows

Workflows 展示多员工群聊式业务线程：

- 当前参与员工。
- handoff 来源、目标、原因和状态。
- 工具调用、业务状态和 thread summary。
- 从单员工会话升级为 workflow group。

### Memory

Memory 按两层展示：

- 员工私有 memory：`tenant + actorId + employeeId`
- 工作流 thread memory：`tenant + workflowThreadId`

员工私有 memory 不直接共享给其他员工，WorkflowThread 只共享显式 thread context。

### Config

Config 页面保留入口和平台配置：

- channel 凭证。
- entry 启用状态。
- tenant 绑定。
- routingMode。

业务员工能力配置迁移到 Employees / Builder，不再在 Bot 配置中维护“入口员工”或业务人格。

### Tools

Tools / Skills 页面聚焦租户能力资产：

- skill 包。
- tool registry。
- risk level。
- 员工 YAML 中声明的 skills/tools。
- Builder 可选能力来源。

### 推荐导航

```text
Chat          日常会话 / 代入调试
Sessions      统一会话中心
Employees     已发布数字员工
Builder       创建、沙盒、发布数字员工
People        企业人员与绑定
Workflows     多员工业务线程
Memory        私有记忆与线程记忆
Tools         工具/技能/权限
Config        入口与平台配置
Harness       验收测试，可逐步并入 Builder / Workflows
```

## Builder 行为

Builder 继续支持自然语言、模板、fork、手动四种来源，但事实源升级为 RuntimeProfileDraft。

沙盒测试必须满足：

- 使用真实 `MessageIngressRuntime`。
- 使用 draft overlay 组装 RuntimeProfile。
- 可选择测试 actor/person。
- 可查看真实 stream、tool calls、handoff、memory trace。
- 发布前 validation 与 sandbox 最近结果必须有效。

发布后：

- 写入 `corp/{tenant}/employees/{employeeId}.yaml`。
- 初始化 `corp/{tenant}/agents/{instance}` 或默认 workspace。
- 写入 `CLAUDE.md`。
- 注册到 EmployeeManager。
- 可被 Web/IM Runtime Resolver 路由。

## 多员工群聊式工作流

多员工工作流以 `WorkflowThread` 承载，支持：

- 一个业务线程中同时出现多个数字员工。
- 用户、主员工、协作员工共享可观察的业务上下文。
- handoff 作为加速器：自动邀请目标员工、携带 reason/context、记录结果。
- 群聊视图展示参与者、工具调用、交接链和业务状态。

MVP 中 handoff 可以继续使用现有 HandoffEngine / Contract chain，但 UI 和 session 存储按 WorkflowThread 呈现。

## 退化的内容

| 退化 | 原因 |
| --- | --- |
| Chat 页面以 `/api/workdirs` 作为事实来源 | workdir 是运行结果，不是用户可选业务对象 |
| Sessions 页面以 config bot 查询会话 | 无法表达 tenant、actor、employee、workflow |
| Builder `/test` fake trace 作为发布门禁 | 不能证明真实 Runtime、workdir、tool、memory 可用 |
| `entry-bot` / `im-bot` 作为核心 kind | 入口是 channel endpoint，员工才是业务执行者 |
| `messages.db` 仅依赖 `bot_name + chat_id` | 无法支撑多租户、多入口、多 actor、多员工工作流 |

## 保留的内容

| 保留 | 原因 |
| --- | --- |
| `MessageIngressRuntime` | 继续作为 Web / IM / Harness / Builder 沙盒统一消息执行层 |
| `EmployeeDefinition` YAML | 已是数字员工发布资产，适合作为 RuntimeProfile 的 employee 来源 |
| `people.json` | 继续作为企业人员与员工绑定来源 |
| `EmployeeManager` | 继续负责加载、注册和查找已发布员工 |
| `ToolRegistry` | 继续负责工具发现；可用工具以员工 YAML 的 skills/tools 声明为准 |
| `HandoffEngine` / contract chain | 继续承载员工协作，只是表现为 WorkflowThread 事件 |

## 架构影响

| 模块 | 变更 |
| --- | --- |
| `src/types.ts` | 新增 EntryEndpoint、ActorIdentity、RuntimeProfile、ConversationSession 类型 |
| `src/ingress/types.ts` | `IngressMessageInput` 补充 entryId、actorId、target、sessionId |
| `src/ingress/runtime.ts` | 从 bot/workdir 推断改为 Runtime Resolver 驱动 |
| `src/enterprise-routing.ts` | 升级为 Runtime Resolver 的 actor binding 解析部分 |
| `src/store.ts` | messages/session schema 增加 tenant、entryId、actorId、employeeId、instanceId、workdir、mode |
| `src/ws.ts` | Web send_message 传 tenant、entryId、actorId、target，返回 session-aware stream |
| `src/routes/public-routes.ts` | `/api/workdirs` 退化，新增 runtime directory API |
| `src/routes/agent-builder.ts` | draft test 升级为真实 sandbox Runtime |
| `src/routes/harness.ts` | harness case / StepRun 接受 runtime profile 输入，并由 RuntimeResolver 解析 |
| `web/src/pages/Chat.tsx` | 选择 tenant、entry、actor，再加载 session/target |
| `web/src/pages/Sessions.tsx` | 改读 runtime sessions |
| `web/src/pages/AgentBuilder.tsx` | 对话式组装 RuntimeProfileDraft，右侧沙盒走真实 Runtime |
| `web/src/pages/Orchestration.tsx` | 展示 WorkflowThread / group handoff |

## 分阶段落地

### Phase 1: Core Model + Directory API

- 增加核心类型和 Runtime Resolver。
- 新增 `/api/runtime/entries`、`/api/runtime/actors`、`/api/runtime/targets`。
- Sessions schema 加 tenant/entry/actor/employee/instance。
- 保持旧 Chat 可用。

### Phase 2: Web / IM 日常入口统一

- Web Chat 改成选择 tenant、entry、actor/person。
- IM adapter 改成 platform identity -> actor -> binding。
- `send_message` 统一走 Runtime Resolver。
- Sessions 页面改读 runtime sessions。

### Phase 3: Builder Runtime Sandbox

- `AgentDraft` 升级或适配到 `RuntimeProfileDraft`。
- Builder 对话式生成结构化 profile。
- 沙盒消息走真实 Runtime，记录 `builder_sandbox` session。
- 发布门禁从 fake harness 改为真实 sandbox/harness。

### Phase 4: Multi-Employee Workflow

- 新增 `WorkflowThread` 存储与 API。
- handoff 事件写入 workflow thread。
- 群聊式 UI 展示参与者、任务状态、工具调用和交接链。
- 支持从单员工会话升级为 workflow group。

## 已确认决策

### 1. RuntimeInstance 默认按 actor + employee 固定隔离

默认：

```text
RuntimeInstance = tenant + actorId + employeeId
SDK session     = tenant + entryId + actorId + employeeId + chatId
```

同一个 actor 使用同一个 employee 时，长期共用一个员工实例和 workdir；不同 chatId 使用不同 Claude SDK session。

未来如果出现同一个 actor 对同一个 employee 需要多个独立项目/案件实例的需求，再增加显式 `instanceScope`：

```ts
instanceScope?: 'default' | 'project' | 'case';
caseId?: string;
```

MVP 不开放隐式多实例，避免 Sessions 和 Memory 过早复杂化。

### 2. Web 代入人员受权限控制

Web impersonation 是受控能力：

| 用户类型 | 行为 |
| --- | --- |
| 管理员 / 授权运营 | 可以选择权限范围内的 actor |
| 普通 Web 用户 | 只能代表自己 |
| 开发 / Harness | 可以显式代入测试 actor |

`/api/runtime/actors` 必须按当前登录用户权限过滤，不能简单返回全员。

### 2.1 Harness 代入测试 actor

Harness 用于验收 Web/IM 路由语义时，可以显式写入 `tenant + entryId + actorId + target`。这代表“以某个测试 actor 进入某个入口”，不是绕过权限直接指定 workdir。

约束：

- 真实 `/api/admin/harness/run` 注入 Runtime Resolver。
- `expect.runtime` 必须能断言 employee、instance、workdir、sdkSessionScope 和 mode。
- fake/offline 的 `runtime.resolved` 只服务 CI 快速回归，不作为生产输入事实源。

### 3. Builder 沙盒默认只读 + 写模拟

Builder 沙盒默认验证员工逻辑，不直接修改生产数据。

| 工具类型 | 沙盒行为 |
| --- | --- |
| read-only | 可读取真实或测试数据，仍受员工 YAML 的 skills/tools 声明控制 |
| internal_write | 默认 dry-run/mock |
| external | 默认拦截或 dry-run |
| destructive | 默认拦截 |

真实写测试只允许显式 sandbox tenant 或隔离数据副本。发布前可以验证写权限和参数映射，但不在生产数据里真实写一遍。

### 4. WorkflowThread 使用共享 thread memory，不共享员工私有 memory

多员工工作流中保留两层记忆：

```text
employee memory:
tenant + actorId + employeeId

thread memory:
tenant + workflowThreadId
```

每个 employee 的长期 memory 保持私有。WorkflowThread 共享的是 thread summary、业务状态、显式上传材料、handoff reason、工具结果摘要等线程上下文。

handoff 通过显式 context 加速协作，不把源员工的全部私有 memory 暴露给目标员工。
