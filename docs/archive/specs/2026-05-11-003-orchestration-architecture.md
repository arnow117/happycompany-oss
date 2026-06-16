# ADR 001: Multi-Agent Orchestration Architecture

**Status:** Accepted  
**Date:** 2026-05-11  
**Deciders:** arnow117  

## Context

happycompany 的 agent 编排系统需要支持多个数字员工（Claude Agent）之间的协作。现有 `DynamicHandoffOrchestrator` 仅支持串行链式交接（A→B→C），无法处理以下真实场景：

- Agent A 同时需要 B1 和 B2 的结果才能继续
- B1 执行到一半发现自己也需要 C1 的输入
- 交接完成后结果需要回传给发起方

此外，当前交接协议依赖正则从 LLM 输出文本提取 JSON——脆弱且不可扩展。

## Decisions

### Decision 1: Contract 树模型

**选择**: 每个工作单元 = `Contract { id, parentId, fromAgent, toAgent, task, status, result }`，以 `parentId` 串成树。

**Rejected alternatives:**
- **栈模型** — 无法表达扇出（A→B1 + A→B2），pop 只能回到上一层
- **DAG** — 过度设计，实际流程不需要预定义图拓扑

**Consequences:**
- 父 agent 需等待所有子合同完成后重新唤起（`waiting` 状态）
- Contract 生命周期：`pending → active → waiting → done/failed`

### Decision 2: 原生 MCP handoff 工具

**选择**: 注册 `handoff` MCP 工具给每个 agent。Agent 通过工具调用（非文本输出）声明交接意图。

```json
{
  "name": "handoff",
  "description": "将当前任务转交给其他数字员工。知道目标就填 target，不知道留空由调度器自动匹配。",
  "inputSchema": {
    "target": "string (可选)",
    "task": "string (必填)",
    "context": "object (可选)"
  }
}
```

**Rejected alternatives:**
- **文本正则在 LLM 输出提取 JSON** — 格式不稳定，换行/转义/代码块都可能导致解析失败

**Consequences:**
- `ClaudeAgentAdapter.execute()` 需改为监听 SDK `tool_use` 消息
- 每个 agent 的 MCP 工具集中自动注入 handoff

### Decision 3: Director 两级路由

**选择**: 关键词匹配优先，模糊匹配降级 LLM。

```
handoff({target}) → target 明确 → 直接路由
handoff({task}) → target 未指定:
  1. 关键词匹配 (capabilities + role + description) → 命中 → 直接路由
  2. 降级 LLM 语义匹配 (Haiku) → 找到 → 路由 / NONE → 标记 failed
```

**Rejected alternatives:**
- **纯关键词** — "浙江省三类医疗器械备案流程" 无法匹配 "器械注册" capability
- **纯 LLM** — 明确匹配时浪费 500ms 延迟 + API 费用

**Consequences:**
- 关键词匹配器需维护和调优
- LLM 路由用 Haiku（低成本、低延迟），仅在降级时调用
- 每次路由决策记录到 `routing_decisions` 表（可审计、可优化）

### Decision 4: SQLite 状态持久化

**选择**: Contract 状态写入 SQLite，两张表：

```sql
contracts: id, parentId, fromAgent, toAgent, task, status, result, createdAt, finishedAt
routing_decisions: id, contractId, method, candidates, chosen, reason, score, createdAt
```

**Rejected alternatives:**
- **InMemoryChainStore** — 重启丢数据，编排无法恢复
- **文件 checkpoint** — 需自行实现回放逻辑

**Consequences:**
- 编排器重启后从 contracts 表恢复未完成的树
- 前端可直接查询合同状态和路由历史
- `routing_decisions` 表支持后续优化（高频路由补 keywords、LLM 误判回顾）

### Decision 5: 串行主循环 + 并行子合同

**选择**:
- 主编排器串行执行（每次只跑一个 agent）
- 单个 agent 可创建多个子合同
- 父 agent 等所有孩子完成后重新唤起汇聚

**Rejected alternatives:**
- **全并行** — happycompany 的 agent 是 Claude Code 子进程，并行多个进程资源消耗高且收益有限

**Consequences:**
- 复杂度可控，不需要并行调度器
- 子合同自然形成执行树，可逐层展开

## Summary

```
Agent → handoff MCP tool → Director (keyword → LLM fallback)
  → Contract { parentId, status } → SQLite persistence
  → Sub-contracts tree → Parent waits → Re-invoke to aggregate
  → Routing trace saved for audit
```
