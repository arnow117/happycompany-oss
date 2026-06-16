# ADR-001: 数字员工网络架构

**日期**: 2026-05-10  
**状态**: 已采纳  
**决策者**: arnow117

## 背景

happycompany 当前是多 bot 单 Agent 模式 — 每个 bot 独立运行一个 Claude Agent，bot 之间没有协作。需要决定多 Agent 之间的协作架构，特别是在以下场景：
- 医疗器械 CRM 业务流程（合同跟进、发票、维修、招标）
- 定时巡检和调度
- 与人（飞书/钉钉用户）的交互

## 决策

采用 **数字员工网络** 架构。核心原则：

1. **Agent 是数字分身**：每个 Agent 代表某一类公司员工（合同员、维修工程师、招标员），拥有该角色的领域知识和流程判断能力
2. **Agent 拥有流程**：业务流程逻辑封装在 Agent 的 system prompt（CLAUDE.md）中，不在外部编排器定义
3. **Agent 之间平等**：任何 Agent 都可以通过 handoff 机制调用通讯录中的其他 Agent
4. **调度员只管路由**：Scheduler 维护一张"谁能解决什么问题"的通讯录，只在触发时将任务派给对应的 Agent
5. **人也是参与者**：Agent 在需要决策时可以主动找真人（发飞书/钉钉消息），等待回复后继续

```
Scheduler（通讯录：合同→contract-agent, 发票→invoice-agent, 维修→repair-agent）
  │
  ├─ "合同到期提醒" → contract-agent → 自己判断要不要开发票、要不要安排维修
  ├─ "新中标"       → bid-agent      → 自己判断中了标要干嘛
  └─ "维修请求"     → repair-agent   → 自己判断现场还是远程
```

## 替代方案

### 方案 A: 中央编排器（PMO）

设置一个中央 PMO Agent 知道所有业务流程，其他 Agent 只是数据查询工具。

**放弃原因**：
- PMO 变成单点，system prompt 会急剧膨胀
- 流程逻辑和领域知识分离，维护成本高
- 违背"Agent 是员工数字分身"的直觉
- 员工之间互相不知道对方存在，灵活性差

### 方案 B: 固定流水线（Pipeline）

在外部定义 Agent A → Agent B → Agent C 的固定执行序列。

**放弃原因**：
- 真实业务流程分支多（合同金额不同路径不同）
- 无法处理 Agent 动态决策（"这个合同金额大到需要走法务"）
- 外部定义无法表达复杂条件逻辑，最终还是要写进 Agent prompt

## 技术映射

| 架构概念 | 代码实现 |
|---------|---------|
| 数字员工 | `ClaudeAgent` + 角色 CLAUDE.md（system prompt） |
| 数字员工群体 | `AgentColonyManager` + AppDefinition YAML |
| 通讯录 | AppDefinition YAML 的 `capabilities` + `allowedTargets` |
| Handoff | `DynamicHandoffOrchestrator`（handoff-engine.ts） |
| 调度触发 | `TaskScheduler` |
| 找人 | MCP `send_message` 工具 |

## 演进路径

- **Phase 1（当前）**: 接线 `DynamicHandoffOrchestrator`，让 colony agent 之间可以 handoff
- **Phase 2**: 完善 Scheduler 的通讯录路由（按 `capabilities` 匹配）
- **Phase 3**: Agent 发起人机交互（`send_message` + 等待回复后继续）

## 关联文档

- [多 Agent 编排实现计划](../../../.claude/plans/delightful-bubbling-petal.md)
- [DynamicHandoffOrchestrator 源码](../src/orchestrator/handoff-engine.ts)
- [AgentColonyManager 源码](../src/orchestrator/agent-colony.ts)
