# Collaboration Workflow Cases

**日期**: 2026-06-02
**状态**: 草案

## 背景

旧的“多员工工作流”页面把两种语义混在一起：

- 正常对话中按需发生的员工路由、工具调用和 handoff。
- 管理员手动创建的 `WorkflowThread`，像一个人工拉群线程。

平台重构后，真实业务入口已经统一到 Runtime：

```
Entry + Actor + RuntimeProfile -> ConversationSession -> RuntimeMessage + IngressTrace
```

因此 workflow 不应再由用户手动创建。它应该是一次业务事项在多个数字员工之间流转后形成的可观测轨迹。

## 决策

将 `/orchestration` 从“手动 Workflow Threads”改为“协同日志 / 事项流转”页面。

新页面不创建 workflow，不手动添加 participant。它从真实 Runtime 会话和协同事件中还原：

- 谁发起了问题。
- 系统路由到哪个数字员工。
- 数字员工调用了哪些工具。
- 是否发生 handoff，谁交给谁，原因是什么。
- 最终回复或错误是什么。

Chat 页面仍然是业务入口。当本次对话发生 handoff 时，Chat 内展示轻量协同提示，让用户看到另一个数字员工被自然引入，但不把 Chat 变成群聊。

## 用户故事

### Chat 中的协同提示

作为业务用户，我在 Chat 里只发起一个问题。如果绑定的数字员工需要别人协作，我希望在回答过程中看到：

```
销售张三 -> 维修李四
需要确认设备维保记录
```

最终回答仍然在当前对话中返回。

### 协同日志

作为管理员或运营人员，我希望打开“多员工工作流”页面后看到所有发生过协同的事项：

- 哪些问题触发了协同。
- 谁找了谁。
- 为什么交接。
- 目标员工是否调用工具、是否出错。
- 最后结果是什么。

### 工作流挖掘输入

作为平台建设者，我希望这些协同日志能成为后续“工作流挖掘”的输入。高频协同链路可以被提取为候选 SOP / workflow template / skill。

## 页面行为

### 事项列表

显示协同 case：

- 标题或消息预览。
- Entry / Actor。
- 当前或最后处理员工。
- 参与员工。
- handoff 次数。
- 工具调用次数。
- 状态。
- 最近更新时间。

默认只突出发生过 handoff 的协同事项；可通过筛选查看全部 Runtime 会话。

### 时间线

点击 case 后显示统一 timeline：

- `user_message`
- `routing_decision`
- `agent_message`
- `tool_call`
- `handoff`
- `memory`
- `error`

### Chat 协同模块

Chat streaming 区展示本轮 handoff 事件。它是运行时提示，不替代后台日志。

## 退化内容

- 废弃页面上的“创建 Workflow”表单。
- 废弃页面上的手动 Owner / Participant / Handoff 控件。
- `WorkflowThread` 暂时保留为兼容数据结构，但不再作为 `/orchestration` 的主产品入口。
- 旧 `/api/orchestration/traces` 保留为调试/兼容接口。

## API 契约

新增：

```
GET /api/runtime/cases
GET /api/runtime/cases/:id/timeline
```

`WorkflowCase` 是 `ConversationSession + RuntimeMessage + RuntimeEvent` 的聚合视图。

`CaseTimelineEvent` 是面向前端的统一事件，不要求前端理解底层 trace 或 message 表。

