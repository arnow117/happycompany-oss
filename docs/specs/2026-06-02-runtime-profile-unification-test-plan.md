# Runtime Profile 统一模型测试计划

**日期**: 2026-06-02
**关联 ADR**: [ADR-004 Runtime Profile 统一入口、会话、Builder 与多员工工作流](../adr/2026-06-02-004-runtime-profile-entry-session-builder-workflow.md)

## 改动总览

把 Web / IM / Sessions / Builder / Workflow 的运行入口收敛到 `RuntimeProfile`、`ConversationSession` 和 `WorkflowThread`，用同一个 Runtime Resolver 解析 tenant、entry、actor、employee、workdir 和 SDK session scope。

## 测试策略

| 层级 | 目标 |
| --- | --- |
| 类型/单元测试 | 核心 schema、Runtime Resolver、session key、workdir 安全 |
| 路由/API 测试 | runtime directory、runtime messages、sessions、builder sandbox、workflow API |
| Ingress 集成测试 | Web/IM/Harness/Builder sandbox 都进入同一个 `MessageIngressRuntime` |
| Store 迁移测试 | messages/sessions 支持 tenant、entry、actor、employee、instance、mode 查询 |
| Web 单测 | Chat、Sessions、AgentBuilder 的状态与 API payload |
| Playwright E2E | Web 日常聊天、代入人员路由、Builder 沙盒发布、多员工 workflow |
| Harness | 用 YAML fixture 验证 binding、session、tool、handoff、workflow trace |

## 新增单元用例

### Runtime Resolver

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| Web actor 已绑定默认员工 | tenant + web entry + actorId | 返回默认 `RuntimeProfile`，包含 employee、workdir、sdkSessionScope |
| Web actor 未绑定 | tenant + web entry + actorId | 返回 selector / binding required，不创建业务 session |
| IM 用户已绑定 | platform user id + dingtalk entry | 解析到 people actor 和绑定 employee |
| IM 用户未绑定 | platform user id + dingtalk entry | 返回绑定提示 |
| target employee override | Web 指定 employeeId | 只允许同租户且 actor 有权限时解析 |
| workdir 越界 | employee workspace 含 `..` 或绝对外部路径 | resolver/validator 返回错误 |
| 同名 employee 跨租户 | tenant A/B 同 id | 解析结果不串租户 |
| 前端传入 workdir | Runtime message body 含 `workdir` | 忽略或拒绝该字段，最终 workdir 只由 resolver 计算 |
| actor-scoped workdir | 同 employee、不同 actor | 生成不同 `RuntimeInstance.workdir` |
| conversation-scoped SDK session | 同 actor/employee、不同 chatId | 生成不同 `sdkSessionScope` |
| actor employee memory | 同 actor/employee、不同 chatId | 使用同一个 memory namespace，但不同 SDK session |
| 普通 Web 用户 actor 列表 | 非管理员请求 `/actors` | 只返回自己的 actor |
| 管理员 actor 列表 | 管理员请求 `/actors` | 返回权限范围内可代入 actor |

### Conversation Session

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 创建单员工 session | RuntimeProfile + chatId | 写入 tenant、entryId、actorId、employeeId、instanceId、workdir |
| 复用已有 session | 相同 tenant/entry/actor/chatId/employee | 返回原 session |
| 同 chatId 不同 actor | actorId 不同 | 创建不同 session |
| 同 actor 不同 employee | employeeId 不同 | 创建不同 session |
| builder sandbox session | draftId + actorId | `mode=builder_sandbox`，不污染正式 employee sessions |
| workflow group session | workflowThreadId | `mode=workflow_group`，包含 participants |
| Web/IM session 隔离 | 相同 actor/employee/chatId，不同 entryId | 创建不同 session 或明确归并策略，不发生隐式串线 |
| session workdir 持久化 | RuntimeProfile 创建 session | session 记录 resolver 计算出的 workdir 与 sdkSessionScope |

### Builder Draft

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 自然语言生成 draft | prompt + tenant | 生成 `RuntimeProfileDraft`，状态 `draft` |
| validate draft | draft profile | 检查 role、tools、skills、handoff target、workspace |
| sandbox message | draftId + actorId + text | 走真实 Runtime，生成 sandbox session 和 trace |
| sandbox write tool dry-run | draft 调用 `internal_write` tool | 不写生产数据，trace 标记 dry-run/mock |
| sandbox destructive tool blocked | draft 调用 destructive tool | 调用被拦截，validation 或 trace 给出风险原因 |
| sandbox 后编辑 | 修改 profile 字段 | sandbox result 失效，发布 disabled |
| publish | sandbox passed draft | 写 employee YAML、CLAUDE.md、注册 EmployeeManager |
| publish 后 Web 可路由 | 新员工绑定到 actor | Runtime Resolver 能解析到新员工 |

### WorkflowThread

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 创建 workflow | owner employee + participants | 创建 `WorkflowThread` 和 group session |
| handoff 拉入员工 | from/to/reason | 写入 handoff event，目标员工成为 participant |
| 群聊消息 | workflowThreadId + text | 路由到 owner 或指定 participant，并记录 trace |
| 私有 memory 不共享 | 员工 A handoff 给员工 B | B 只能看到 thread summary/context，看不到 A 的全部私有 memory |
| thread memory 共享 | 多员工写入 workflow summary | 参与员工都能读取 thread memory 摘要 |
| 从单聊升级 workflow | sessionId + target employee | 保留原上下文，创建 workflow group |
| workflow 完成 | close action | session 状态完成，后续消息需新建或重新打开 |

### Web Platform 收口

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| Chat 不以 workdir 为主选择 | 打开 Chat | 主选择项是 tenant / entry / actor / session，workdir 只在详情中展示 |
| Chat/Sessions 一致 | Chat 创建一条会话 | Sessions 能按同一 tenant/entry/actor/employee 查到该会话 |
| Sessions 不按 bot 查询 | 打开 Sessions | API 使用 runtime sessions，不使用 `/api/admin/bots/:name/sessions` 作为事实源 |
| Employees 不直接生成生产员工 | 点击创建/生成/fork | 跳转或进入 Builder draft，不直接调用旧生成接口发布 |
| Builder 发布后 Employees 可见 | 发布 draft | Employees 列表出现新员工，Chat Runtime Resolver 可路由 |
| Config 不配置业务人格 | 打开 Config bot/entry 编辑 | 只展示入口/channel/routing 配置，不维护 employee prompt/tools |
| Memory 双层展示 | 打开 Memory | 可区分 employee private memory 与 workflow thread memory |
| Workflow 从 session 升级 | 单员工会话触发 handoff/group | Workflows 可见同一业务线程和参与员工 |

## 新增 API 用例

### Runtime Directory

```text
GET /api/runtime/entries?tenant=acme-happycompany
GET /api/runtime/actors?tenant=acme-happycompany&entryId=web-bot
GET /api/runtime/targets?tenant=acme-happycompany&entryId=web-bot&actorId=...
```

预期：

- 只返回当前 tenant 的 entry、actor、target。
- Web entry 可返回可代入人员。
- IM entry 不返回任意 actor selector，只返回绑定状态或管理视图。

### Runtime Messages

```text
POST /api/runtime/messages
WS send_message
```

预期：

- payload 必须包含 tenant、entryId、actorId、chatId、text。
- `POST /api/runtime/messages` 返回 `reply`、`session`、`runtime` 和 `trace`，其中 `session.workdir` 必须由 resolver 计算。
- WS `send_message` 返回 `runner_state`、`new_message`、`stream_event`，并携带 session-aware `meta`：`tenant`、`entryId`、`actorId`、`sessionId`、`employeeId`、`instanceId`、`workdir`、`sdkSessionScope`、`mode`。
- Web Chat Runtime 模式按 `tenant + entryId + actorId + chatId` 识别回包；如果前端尚未选择目标员工，但后端按默认绑定路由到员工，也不能丢弃该回包。
- 未绑定 actor 不吞消息，返回明确 `binding_required`。
- stream protocol 与当前 Web/IM 对齐。

### Sessions

```text
GET /api/runtime/sessions?tenant=...&entryId=...&actorId=...
GET /api/runtime/sessions/:id
```

预期：

- Sessions 页面显示的数量与 Chat 入口实际可见会话一致。
- 可按 entry、actor、employee、mode 筛选。
- 旧 bot sessions 不再作为主数据源。

### Builder

```text
POST /api/builder/drafts/:id/sandbox/messages
```

预期：

- 使用真实 Runtime。
- trace 中能看到 draft employee、tools、memory、handoff。
- 不写正式 employee YAML。

### Workflow

```text
POST /api/runtime/workflows
POST /api/runtime/workflows/:id/handoff
POST /api/runtime/workflows/:id/messages
```

预期：

- workflow session 有多个 participant。
- handoff 事件能在 trace 和 UI 中展示。
- 工具权限仍按目标 employee role 检查。

## 修改现有用例

| 现有测试 | 修改 |
| --- | --- |
| `tests/ingress/runtime.test.ts` | 增加 RuntimeProfile/entry/actor/session 断言 |
| `tests/routes/agent-builder.test.ts` | `/test` 从 fake trace 改为 sandbox runtime 或分离 fake/sandbox 两组 |
| `tests/ingress/harness.test.ts` | harness adapter 支持 `input.runtime`、resolver 注入、`expect.runtime` |
| `tests/routes/harness.test.ts` | `/api/admin/harness/run` 和 StepRun 支持 RuntimeResolver 解析 entry/actor/target/session mode |
| `web/src/pages/Chat.test.tsx` | 断言 Web 发送 tenant/entryId/actorId/target |
| `web/src/pages/AgentBuilder.test.tsx` | 断言沙盒消息与发布门禁 |
| `web/e2e/story-q-chat-websocket/story-q.spec.ts` | 按 actor/person 选择后发送 |
| `web/e2e/story-v2-agent-builder-doc/agent-builder-doc.spec.ts` | 加真实 sandbox 状态 |

## 新增 Harness Fixtures

```text
tests/fixtures/harness/runtime-profile-web-entry-default.yaml
tests/fixtures/harness/runtime-im-binding-routes.yaml
tests/fixtures/harness/runtime-session-isolation.yaml
tests/fixtures/harness/builder-sandbox-runtime.yaml
tests/fixtures/harness/workflow-group-handoff.yaml
```

当前已落地：

- `runtime-profile-web-entry-default.yaml`
- `runtime-profile-im-entry-binding.yaml`

- fake/offline 模式使用 `runtime.resolved`，保证 `npm run harness:fake` 不依赖真实 corp。
- 服务端 `/api/admin/harness/run` 忽略 fixture resolved fallback，优先注入 `RuntimeResolver`。
- `expect.runtime` 断言 tenant、entryId、actorId、employeeId、instanceId、workdir、sdkSessionScope 和 mode，专门防串线。

## 验证命令

```bash
npx vitest run tests/ingress/runtime.test.ts tests/routes/agent-builder.test.ts tests/routes/harness.test.ts
npm run harness:fake
npm run build
cd web && npm run build
cd web && npx playwright test e2e/story-q-chat-websocket/story-q.spec.ts e2e/story-v2-agent-builder-doc/agent-builder-doc.spec.ts
```

## 2026-06-02 验证快照

已通过：

- `npm run typecheck`
- `just check`
- `just consistency`
- `npm run test`
- `VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/runtime-resolver.test.ts tests/routes/runtime-routes.test.ts tests/ingress/runtime.test.ts tests/ingress/harness.test.ts tests/routes/harness.test.ts tests/routes/agent-builder.test.ts tests/bot.test.ts tests/store.test.ts`
- `cd web && npm run test -- ChatView.test.tsx Sessions.test.tsx AgentBuilder.test.tsx Orchestration.test.tsx`
- `cd web && npm run test`
- `cd web && npm run build`
- `npx tsx src/harness-cli.ts --suite tests/fixtures/harness --fake --json`
- `npm run harness:fake`
- `cd web && npx playwright test e2e/story-q-chat-websocket/story-q.spec.ts e2e/story-h-sessions/story-h.spec.ts e2e/story-v2-harness/harness.spec.ts --reporter=line`
- `cd web && npx playwright test e2e/story-v2-product-journey/story-v2.spec.ts --reporter=line`
- `cd web && npx playwright test --reporter=line`

最终全量结果：

- Server Vitest: 116 files passed, 1325 passed, 5 skipped.
- Web Vitest: 22 files passed, 175 passed.
- Harness fake: 31 passed, 0 failed.
- Playwright E2E: 41 passed.
- Consistency check: 12 PASS, 0 FAIL.
- Production smoke: `http://127.0.0.1:3100/`、`/chat`、`/api/health` 和 `/api/runtime/entries?tenant=acme-happycompany` 可访问。
- Dev smoke: `http://127.0.0.1:8888/chat` 可访问。

已覆盖：

- Web runtime entry 默认路由 fixture。
- IM/dingtalk runtime entry 绑定员工 fixture。
- Chat WebSocket runtime meta 和消息回包。
- Sessions runtime session 查询与归档。
- Builder Runtime 沙盒试聊和发布 gate。
- Workflow Threads 的 participants、handoff 和最小 message 执行。

尚未作为本轮阻塞验证：

- 全量 `just pre-pr`。
- 真实 IM 平台端到端 smoke。
- Builder 写工具 dry-run/mock 的完整工具级隔离。
- Workflow thread memory 摘要、自动 handoff 回写、完整群聊时间线。

## Done 定义

- Web 和 IM 都通过 Runtime Resolver 进入同一个 `MessageIngressRuntime`。
- Chat 和 Sessions 对同一 tenant/entry/actor/employee 的会话数量一致。
- Builder 沙盒不再依赖 fake trace 作为主要发布门禁。
- 发布后的员工能被 Web/IM 立即路由。
- WorkflowThread 能展示多员工参与和 handoff 事件。
- 旧 `/api/workdirs` 和 bot sessions 不再是前端主事实来源。
