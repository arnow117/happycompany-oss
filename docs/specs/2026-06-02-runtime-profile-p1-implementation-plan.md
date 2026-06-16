# Runtime Profile P1 实施方案

**日期**: 2026-06-02
**关联**:
- [ADR-004 Runtime Profile 统一入口、会话、Builder 与多员工工作流](../adr/2026-06-02-004-runtime-profile-entry-session-builder-workflow.md)
- [Runtime Profile 统一模型测试计划](./2026-06-02-runtime-profile-unification-test-plan.md)

## P1 目标

P1 原始范围只包含核心模型、Runtime Resolver、runtime directory API 和 session 存储。经过本轮讨论后，范围扩展为 P1+：在核心模型稳定的同时，纳入 Builder Runtime 沙盒发布 gate 和 WorkflowThread 最小工作台，确保 Web/IM/Builder/Harness/Workflow 都收口到同一套 Runtime Profile 入口。

P1+ 完成后必须成立：

- Web Chat 不再以最终 `workdir` 作为发送事实源。
- Web send_message 传 `tenant / entryId / actorId / chatId / target`。
- 后端 Runtime Resolver 统一解析 employee、instance、workdir、sdkSessionScope。
- Messages 和 Sessions 记录 tenant、entry、actor、employee、instance、workdir。
- Chat 和 Sessions 读取同一套 runtime session 数据。
- Builder 沙盒试聊走真实 Runtime，写入 `builder_sandbox` session，并作为发布 gate。
- WorkflowThread 能创建 `workflow_group` session，展示 participants/handoff，并向参与员工发送最小 workflow message。
- 旧 `/api/workdirs` 和 bot sessions 短期保留，但前端主路径不依赖它们。

## 非目标

P1+ 不做：

- Builder 写工具 dry-run/mock 的完整工具级隔离。
- Workflow thread memory 摘要、自动 handoff 回写和完整群聊时间线。
- 同一 actor/employee 下多项目实例 `instanceScope`。
- 完整 RBAC。P1 只保留权限接口形状：dev/admin 可见全员，普通用户预留只看自己。
- 历史消息强迁移。P1 只保证新消息进入新 session model。

## 文件级改造

### 1. 核心类型

新增：

```text
src/runtime-profile.ts
```

包含：

```ts
EntryChannel
EntryEndpoint
ActorIdentity
RuntimeTarget
RuntimeInstance
RuntimeProfile
ConversationSession
RuntimeMessageInput
```

保留 `src/types.ts` 中 `BotConfig`，但 runtime 新类型不直接塞进旧 BotConfig，避免旧配置和新模型互相污染。

### 2. Runtime Resolver

新增：

```text
src/runtime-resolver.ts
```

职责：

- 从 config bots 和 employee manager 生成 `EntryEndpoint`。
- 从 tenant `people.json` 生成 `ActorIdentity`。
- 根据 `tenant + entryId + actorId + target` 解析员工。
- 计算：

```text
instanceId       = tenant + actorId + employeeId
workdir          = corp/{tenant}/{employee.workspace}/{actorId}
sdkSessionScope  = tenant + entryId + actorId + employeeId + chatId
memory namespace = tenant + actorId + employeeId
```

硬约束：

- Resolver 不接受前端传入最终 `workdir`。
- employee 必须属于同 tenant。
- workdir 必须位于 tenant 目录内。
- 未绑定 actor 返回 `binding_required`，不能吞消息。

### 3. MessageStore schema

修改：

```text
src/store.ts
```

新增表：

```sql
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  workdir TEXT NOT NULL,
  sdk_session_scope TEXT NOT NULL,
  mode TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
)
```

为 `messages` 表新增 nullable columns：

```text
session_id
tenant
entry_id
actor_id
employee_id
instance_id
workdir
mode
```

新增方法：

```ts
upsertConversationSession(session: ConversationSession): void
listRuntimeSessions(filter): RuntimeSessionSummary[]
getRuntimeSession(sessionId): ConversationSession | null
listMessagesForSession(sessionId, limit): PersistedMessage[]
```

旧方法 `listChats(botName)`、`listMessages(chatId)` 保留兼容。

### 4. Ingress 类型和 Runtime

修改：

```text
src/ingress/types.ts
src/ingress/runtime.ts
src/ingress/trace-recorder.ts
```

`IngressMessageInput` 增加：

```ts
entryId?: string;
actorId?: string;
sessionId?: string;
employeeId?: string;
instanceId?: string;
workdir?: string; // 只允许 resolver 填入，adapter 传入时忽略或拒绝
mode?: 'single_employee' | 'workflow_group' | 'builder_sandbox';
sdkSessionScope?: string;
```

`MessageIngressRuntime.handle()` 在 P1 中仍调用：

```ts
agentFactory.respond(prompt, input.chatId, input.botName, opts)
```

但 `input.botName` 必须由 resolver 设为最终 employeeId，而不是 Web workdirId。

`IngressTrace` 增加 `runtime` 快照：

```ts
runtime?: {
  tenant?: string;
  entryId?: string;
  actorId?: string;
  sessionId?: string;
  employeeId?: string;
  instanceId?: string;
  workdir?: string;
  sdkSessionScope?: string;
  mode?: 'single_employee' | 'workflow_group' | 'builder_sandbox';
}
```

这份快照用于 Harness/report/UI 验证运行时是否串 tenant、actor、employee、workdir 或 SDK session。

### 5. Runtime Routes

新增：

```text
src/routes/runtime-routes.ts
```

API：

```text
GET /api/runtime/entries?tenant=...
GET /api/runtime/actors?tenant=...&entryId=...
GET /api/runtime/targets?tenant=...&entryId=...&actorId=...
POST /api/runtime/messages
GET /api/runtime/sessions?tenant=...&entryId=...&actorId=...&employeeId=...
GET /api/runtime/sessions/:id
GET /api/runtime/sessions/:id/messages
DELETE /api/runtime/sessions/:id
```

`POST /api/runtime/messages` 与 WebSocket `send_message` 使用同一个 Runtime Resolver 和 `MessageIngressRuntime`。HTTP endpoint 用于 Web/IM 管理面、Harness/Builder 调试和 API 级验证；前端或外部调用方即使传入 `workdir`，也不能覆盖 resolver 计算出的最终 `workdir`。

`DELETE /api/runtime/sessions/:id` 不删除消息和 SDK session 文件，只写入 `archivedAt` 并让默认 session 列表隐藏该会话；调试或后续“已归档”视图可通过 `includeArchived=true` 查询。

### 6. Harness / StepRun

Harness case 支持两类输入：

```yaml
input:
  botName: legacy-web-entry
  chatId: harness-runtime-web-default
  text: 查一下客户进度
  runtime:
    tenant: tenant-a
    entryId: web-bot
    actorId: user-sales
    target:
      employeeId: sales-zhangsan
```

服务端 `/api/admin/harness/run` 在依赖齐全时注入 `RuntimeResolver`，用 `tenant + entryId + actorId + target` 解析 employee、workdir、sdkSessionScope，再调用 `MessageIngressRuntime`。

为保持 `harness:fake` 可离线运行，fixture 可携带 `runtime.resolved` 快照。这个字段只作为 fake/offline fallback；真实服务端优先 resolver，不接受 fixture 指定 workdir 作为最终事实。

`expect.runtime` 可断言：

- tenant / entryId / actorId
- sessionId / sdkSessionScope
- employeeId / instanceId
- workdirContains
- mode

StepRun 同样支持 `runtime` 输入，避免长任务 Harness 继续把 `employeeId` 当入口 bot。

### 7. WebSocket

修改：

```text
src/ws.ts
```

新 payload：

```ts
{
  type: 'send_message',
  tenant,
  entryId,
  actorId,
  chatId,
  content,
  target?: { employeeId?: string },
  attachments?
}
```

兼容期：

- 如果收到旧 `workdirId`，转换为 `target.employeeId` 或 entryId fallback，并记录 legacy path。
- 新 UI 不发送 `workdirId`。

### 6.1 IM Adapter Runtime 解析

`BotManager` 在 channel 消息进入 `MessageIngressRuntime` 前执行 Runtime Resolver：

- 条件：bot config 有 `tenant`，消息有 `fromUserId`，并且运行时注入了 `corpDir` 与 `employeeManager`。
- 输入：`tenant + entryId(botName) + actorId(fromUserId) + chatId + text`。
- 输出：`botName=employeeId`、`sessionId/sdkSessionScope`、`entryId`、`actorId`、`employeeId`、`instanceId`、`workdir`、`mode=single_employee`。
- 未绑定或找不到 actor 时，IM 返回绑定提示，不创建空 session，也不吞消息。
- Slash command 仍优先走旧命令路径，避免显式切换命令被当成业务消息。

WS 返回事件增加：

```text
sessionId
entryId
actorId
employeeId
instanceId
```

### 7. Public Routes

修改：

```text
src/routes/public-routes.ts
```

新增注册 runtime routes。

保留：

```text
/api/workdirs
/api/workdir/:id/sessions
/api/chat/:botName/history
```

但标记为 legacy，主前端路径不再调用。

### 8. Web API Client

修改：

```text
web/src/lib/api.ts
```

新增类型和方法：

```ts
RuntimeEntry
RuntimeActor
RuntimeTarget
RuntimeSessionInfo

listRuntimeEntries(tenant)
listRuntimeActors(tenant, entryId)
listRuntimeTargets(tenant, entryId, actorId)
listRuntimeSessions(filter)
getRuntimeSessionMessages(sessionId)
```

保留旧 bot session 方法供 legacy 页面或其他页面暂用。

### 9. Chat Store

修改：

```text
web/src/stores/chat.ts
```

新增状态：

```ts
entries
selectedEntryId
actors
selectedActorId
targets
selectedTargetEmployeeId
selectedSessionId
runtimeSessions
```

保留 `selectedWorkdir` 到 P1 结束，但新 ChatView 主逻辑改用 runtime fields。P2 可删除或彻底退化。

### 10. Chat View

修改：

```text
web/src/components/chat/ChatView.tsx
web/src/pages/Chat.tsx
```

P1 UI 不做大视觉重构，只完成行为切换：

- 加载 tenant 后加载 entries。
- 选择 entry 后加载 actors。
- 选择 actor 后加载 targets 和 sessions。
- 发送消息使用 runtime payload。
- 历史加载使用 runtime session messages。
- workdir 仅显示在调试详情，不作为主 selector。

### 11. Sessions Page

修改：

```text
web/src/pages/Sessions.tsx
```

改为：

- tenant filter
- entry filter
- actor filter
- employee/mode columns
- 调用 runtime sessions API
- Clear/Archive 调用 runtime session archive API，不再只是前端假反馈

P1 可以保留简化表格，不做完整视觉升级。

## 数据迁移策略

P1 不强迁移旧消息。

新消息：

- 必须创建或更新 `conversation_sessions`。
- 必须写入 `messages.session_id` 和 runtime columns。

旧消息：

- 旧 `/api/chat/:botName/history` 仍可查询。
- Runtime Sessions 页面默认展示新 runtime sessions。
- 后续可加 legacy migration，把旧 `bot_name + chat_id` 转为 `mode=legacy`。

## 本轮 Feature 收口边界

本轮以 Runtime Profile 作为统一事实源，交付到可日常使用的 Web 主路径：

- Web/IM 都通过 `tenant + entry + actor + target` 进入同一个 Runtime Resolver 和 `MessageIngressRuntime`。
- Web Chat 不再把 workdir 作为业务选择项；管理员代入 actor 后按绑定员工路由。
- Sessions 以 `ConversationSession` 为事实源，能和 Chat 看到同一套 runtime session。
- Builder 提供对话式草稿、结构化配置、Runtime 沙盒试聊和发布前 sandbox gate。
- Harness fixture 支持 Web/IM runtime profile，能断言 employee、workdir、sdkSessionScope，专门防串租户、串 actor、串员工。
- Orchestration 增加 Workflow Threads 最小工作台，支持创建多员工线程、查看 participants/handoff，并向参与员工发送 workflow message。
- Web 平台导航和页面职责收口为 Chat、Sessions、Employees、Builder、People、Workflows、Memory、Tools、Config、Harness。

本轮明确不把以下能力作为 Done 阻塞项，但保留接口和模型位置：

- Builder 写工具 dry-run/mock 的完整工具级隔离。
- Workflow thread memory 摘要生成与展示。
- 自动 handoff 事件从 agent trace 回写到 WorkflowThread。
- 完整群聊式消息时间线和多员工并行执行编排。
- 旧 `selectedWorkdir` 字段彻底删除；P1 仅保证前端主路径不依赖它。

## P1 验收用例

### 后端

- Runtime Resolver 返回 entries、actors、targets。
- 已绑定 actor 解析到 employee。
- 未绑定 actor 返回 binding required。
- 同 employee 不同 actor 生成不同 workdir。
- 同 actor/employee 不同 chatId 生成不同 sdkSessionScope。
- 前端 payload 中 workdir 被忽略或拒绝。
- Runtime session upsert 后能按 tenant/entry/actor 查询。
- Harness runtime fixture 通过 `tenant + entryId + actorId + target` 解析，trace/session 中包含 resolver 计算出的 workdir 和 sdkSessionScope。
- StepRun runtime input 不再把 employeeId 当入口 bot，最终 botName 由 resolver 或 offline resolved runtime 决定。

### 前端

- Chat 发送 payload 包含 tenant、entryId、actorId、target，不包含 workdir。
- Chat 创建消息后 Sessions 页面能查到同一 session。
- Sessions 页面不调用 `/api/admin/bots/:name/sessions`。
- 切换 actor 会刷新 targets/sessions/messages。

### E2E

- `acme-happycompany` 下 Web 选择 actor，发送消息，收到绑定或员工回复。
- Sessions 页面出现刚创建的 runtime session。
- 页面不再出现 workdir 作为主业务选择项。

## 推荐实现顺序

1. 新增 `runtime-profile.ts` 类型。
2. 新增 `runtime-resolver.ts`，先写单元测试。
3. 扩展 `MessageStore` schema 和 runtime session 方法。
4. 新增 runtime routes，并加 route tests。
5. 修改 `MessageIngressRuntime` 写入 session metadata。
6. 修改 `ws.ts` 使用 resolver。
7. 修改 Web API client。
8. 修改 Chat store / ChatView。
9. 修改 Sessions 页面。
10. 跑后端、前端、E2E 验证。

## 风险点

| 风险 | 缓解 |
| --- | --- |
| 旧 bot session 测试大量依赖 `botName` | 保留旧接口和旧 store 方法，P1 不删除 |
| agentFactory 当前按 botName 找 agent | Resolver 在 P1 将最终 employeeId 放入 `botName` |
| Web 状态仍有 selectedWorkdir | P1 保留字段但主路径不使用，P2 再清理 |
| 历史消息缺 runtime columns | 新旧数据分层，P1 不强迁移 |
| 权限过滤尚未完整 | 先实现接口形状和 dev/admin 全员策略 |

## P2 增量：Builder Runtime 沙盒

在 P1 session 模型稳定后，Builder 增加最小 Runtime 沙盒入口：

```text
POST /api/agent-builder/drafts/:id/sandbox/messages
```

请求：

```ts
{
  actorId?: string;
  chatId?: string;
  text: string;
  timeoutMs?: number;
}
```

行为：

- 先复用 Builder validator 校验 draft；校验失败不进入 runtime。
- 通过 `MessageIngressRuntime.handle()` 发送消息。
- 创建 `ConversationSession.mode = builder_sandbox`。
- `entryId = builder-sandbox:{draftId}`。
- `sessionId/sdkSessionScope = tenant + builder_sandbox + draftId + actorId + chatId`。
- `workdir` 位于 `data/agent-builder/sandbox/{tenant}/{draftId}/{actorId}`，不写正式 employee YAML 或正式 workspace。
- 沙盒 workdir 会写入草稿 `CLAUDE.md`，并通过 per-call `runtimeAgentDir/runtimeCwd` 让 Agent SDK 使用草稿 overlay，而不是回退到默认 Web agent。
- Builder 页面提供沙盒试聊控件，返回 reply 和 session id；Sessions 页面可通过 `mode=builder_sandbox` 查询该会话。
- sandbox 通过会写回 draft 的 `sandbox.lastSessionId / lastResult / fingerprint`。
- publish 需要 validation OK、fake harness passed、runtime sandbox passed，且 sandbox fingerprint 与当前 draft 配置一致。
- 草稿结构化字段变更会清空 `harness` 和 `sandbox`，要求重新测试与沙盒试聊。

当前增量先打通 Runtime 会话、消息链路、draft overlay Agent 装配和发布前 sandbox gate；写工具 dry-run/mock 继续在后续 P2 子任务完成。

## P2 增量：WorkflowThread 事实源

新增 Runtime workflow API：

```text
GET /api/runtime/workflows?tenant=...&actorId=...&state=...
POST /api/runtime/workflows
GET /api/runtime/workflows/:id
POST /api/runtime/workflows/:id/handoff
POST /api/runtime/workflows/:id/messages
```

创建 workflow 时：

- 创建 `ConversationSession.mode = workflow_group`。
- `sessionId/sdkSessionScope = tenant + workflow + workflowThreadId`。
- `chatId = workflow:{workflowThreadId}`。
- owner employee 作为 session 的 `employeeId`。
- `WorkflowThread.participants` 记录 owner 和初始参与员工。

handoff 时：

- 要求 `fromEmployeeId` 已在 participants 中。
- 校验 `toEmployeeId` 属于同租户已发布员工。
- 记录 `WorkflowHandoffEvent`。
- 若目标员工尚未参与，则加入 participants。

message 时：

- 默认发送给 owner employee，也可指定 `targetEmployeeId`。
- 要求目标员工已经在 participants 中。
- 通过 `MessageIngressRuntime.handle()` 写入同一个 `workflow_group` session。
- session 继续保留 owner employee 作为业务主责；消息行记录实际执行员工。

当前增量先完成 workflow thread、group session、handoff 事件和最小 message 执行；thread memory 摘要、自动 handoff 事件回写和前端 Workflows 页面完整群聊体验继续在后续 P2/P3 完成。

Web 增量：

- `/orchestration` 增加 Workflow Threads 面板。
- 可从 Runtime Directory 选择 entry、actor、owner 和 participant 创建 `workflow_group`。
- 可查看 thread summary、participants、handoff 事件。
- 可对已选 workflow 手动添加 handoff，把目标员工拉入同一业务线程。
- 可选择 participant 发送 workflow message。
- 发送结果展示 reply；完整消息时间线和自动 handoff 事件回写继续后续完善。
