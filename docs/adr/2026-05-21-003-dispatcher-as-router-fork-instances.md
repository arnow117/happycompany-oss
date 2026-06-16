# ADR-003: 调度员退化为路由层 + 数字员工实例化

**日期**: 2026-05-21
**状态**: 已采纳
**决策者**: arnow117
**关联**: [ADR-001](./2026-05-10-001-digital-employee-network.md), [ADR-002](./2026-05-11-002-digital-employee-demo.md)

## 背景

ADR-002 确立了"一人一数字员工"的 1:1 映射架构，但在实现中引入了 `acme-dispatcher` 作为一个完整的 ClaudeAgent——有自己的 system prompt、session、模型调用——来承担消息路由职责。同时，数字员工 YAML 被多个绑定用户共享为同一个 agent 实例（共享 workdir、session、统计数据）。

这带来三个问题：

1. **调度员作为 Agent 的语义矛盾**：它不执行业务逻辑，只是一个路由器，却要占用模型配额、维护 session、定义权限边界
2. **调度员权限边界模糊**：路由 agent 到底该有哪些 tools/skills？本质上它应该什么都不需要
3. **共享实例破坏隔离性**：多个真实员工绑定到同一个数字员工时，共享 workdir 和 session，导致上下文污染和统计混淆

## 决策

### 1. 调度员从 Agent 退化为路由层

`acme-dispatcher` 不再是 Agent。消息路由是纯代码逻辑：

```
用户消息到达
  │
  ▼
路由层（纯函数，不调模型）
  │
  ├─ people.json 已绑定 assistantId
  │   ├─ fork 实例已存在 → 直连
  │   └─ fork 实例不存在 → 从模板 fork 后直连
  │
  └─ people.json 未绑定
      └─ 返回提示：请先在企业员工页绑定数字员工
```

`entryEmployeeId` 字段从 BotConfig 中移除。`routingMode: 'employee-director'` 保持不变，但其行为变为上述纯路由逻辑。

### 2. Fork 实例化：YAML 模板 → 实例

数字员工 YAML 文件（`corp/{tenant}/employees/{id}.yaml`）作为**模板**，定义人格、技能、角色等。当真实员工绑定时，自动 fork 出独立实例：

```
corp/acme/employees/
├── sales-zhangsan.yaml          ← 模板（人格+技能定义）

corp/acme/agents/
├── sales-zhangsan-{humanUserId}/  ← fork 实例（独立 workdir）
│   ├── CLAUDE.md                  ← 从模板复制
│   ├── SKILL.md                   ← 从模板复制
│   └── .claude/skills/            ← symlink 到共享 skill 池
```

每个实例有独立的 session、workdir、统计。Fork 是懒加载的——真实员工第一次发消息时才创建实例。

### 3. 路由策略配置

替代 `entryEmployeeId`，路由行为通过 `routingMode` 控制：

| routingMode | 行为 |
|-------------|------|
| `direct` | 作为独立 Bot 直接对话 |
| `employee-director` | 纯路由：查 people.json → 有绑定就 fork/直连 → 没有就提示绑定 |

## 退化的内容

| 删除 | 原因 |
|------|------|
| `corp/acme/employees/acme-dispatcher.yaml` | 不再需要 dispatcher agent |
| `BotConfig.entryEmployeeId` | 路由不再需要入口 agent ID |
| `resolveEnterpriseEntryAgent()` 中的 dispatcher fallback | 改为纯路由 |
| `config.json` 各 bot 的 `entryEmployeeId` 字段 | 不再需要 |

## 保留的内容

| 保留 | 原因 |
|------|------|
| `resolveEnterpriseEntryAgent()` 的 personal binding 查找 | 直连逻辑不变 |
| `routeHandoff()` / `director-router.ts` | 员工间相互查找时需要 |
| `PMOOrchestratorRunner` | 多员工 handoff 协作 |
| `people.json` | 核心绑定数据 |
| `routingMode: 'employee-director'` | 语义清晰 |

## 架构影响

| 模块 | 变更 |
|------|------|
| `src/enterprise-routing.ts` | 移除 dispatcher fallback，新增 fork 逻辑 |
| `src/index.ts` | 路由层前置，不再创建 dispatcher agent session |
| `src/types.ts` | `BotConfig.entryEmployeeId` 标记为 deprecated 或移除 |
| `src/routes/admin-config.ts` | 移除 `entryEmployeeId` 的处理 |
| `src/config.ts` | 类型同步 |
| `config.json` / `config.e2e.json` | 移除 `entryEmployeeId` |
| Web Config 页面 | 移除入口员工 ID 字段 |
