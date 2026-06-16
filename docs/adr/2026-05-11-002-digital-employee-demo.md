# ADR-002: 数字员工 Demo 与自生成架构

**日期**: 2026-05-11
**状态**: 草案（已部分被 [ADR-003](./2026-05-21-003-dispatcher-as-router-fork-instances.md) 取代——调度员退化、fork 实例化）
**决策者**: arnow117

## 背景

ADR-001 确立了「数字员工网络」架构——每个 Agent 是某类员工的数字分身，通过 handoff 协作。但创建数字员工的流程完全是手动的：手写 YAML、手配 tools/skills、手写 system prompt。这带来三个问题：

1. **创建门槛高**：非技术人员（业务主管）无法「雇佣」数字员工
2. **工具匹配靠人脑**：不知道哪些企业 skill 能用，也不知道缺了什么 tool
3. **优化靠经验**：多个数字员工之间可能有冗余、衔接断裂，无法系统性地优化

## 需求故事

### 故事 1：自然语言生成数字员工

> 作为企业管理员，我可以用自然语言描述一个新员工的职责，系统自动生成 agent 配置（含 skill 列表、工作流描述、tool 使用说明）。如果描述中的工作流有缺失的 tool，系统会标记出来并设置「飞书人工 fallback」——需要人的环节通过飞书发消息、收回复，视作一次 tool 调用来集成进工作流。

### 故事 2：以合同为核心的 Demo

> 以示例医疗为背景，录入三名数字员工：
> - **销售张三**：合同情报与签署
> - **维修李四**：合同执行（进场维修）与执行信息录入（含回执单签署）
> - **财务王五**：合同管理与结算
>
> 三者以「合同」为核心数据对象形成协作链路：张三签合同 → 李四执行并录入回执 → 王五管理和结算。

### 故事 3：一键优化

> 分析三名 agent 的配置和实际运行数据，沉淀出一个「以合同为中心」的优化后 agent 配置和工作流，消除冗余、补上断点。

### 故事 4：员工图谱可视化

> 以节点/边图展示数字员工之间的数据流关系。每个节点是一个员工（可 fork），每条边代表数据流转（合同→回执→结算单）。旁边有历史统计面板（调用次数、成功率、人工 fallback 次数等）。

## 决策

### 1. 自然语言 → Agent 生成流程

```
用户自然语言描述
  → Claude 解析：提取角色、职责、所需 skill、工作流步骤
  → 交叉比对 corp/{tenant}/ 下已安装的 tools/skills
  → 标记「已覆盖」和「缺失」的 tool
  → 缺失 tool → 生成飞书 fallback skill（send + wait-reply 封装为一次 tool 调用）
  → 输出 YAML agent 定义 + CLAUDE.md 工作流描述
```

**关键假设**：飞书「发消息 + 等回复」可以封装为一个 skill/tool，对 Agent 来说调用签名和普通 tool 一致（输入：飞书用户 ID + 消息内容，输出：用户回复文本），这样 Agent 不需要知道自己在跟人还是跟 API 交互。

### 2. Demo Agent 数据流

```
[销售张三] ──合同数据──→ [维修李四] ──回执单──→ [财务王五]
    │                        │                      │
    ▼                        ▼                      ▼
 情报收集                  进场维修               合同结算
 合同签署                  信息录入               发票管理
                          回执签署
```

**通信方式**：Agent 通过 handoff 传递上下文（合同 ID + 状态 + 已收集的数据），下一个 Agent 基于上下文继续执行。

### 3. Fork 语义

「可 fork」意味着：
- 每个数字员工对应一个真实的人（1:1 映射）
- Fork 操作 = 复制 agent 配置（YAML + CLAUDE.md）到新 ID
- Fork 后的 agent 是独立实例，有自己的 session 和统计
- 图谱中每个节点 = 一个独立的 agent 实例（不是一个模板）

这要求 `AgentColonyManager` 支持同一 `AppDefinition` 的多个实例（当前可能限制为 `id` 唯一），需要引入 `instanceId` 概念。

### 4. 可视化图谱数据模型

```
节点 (Node) = Agent 实例
  - id, displayName, role, skills[], tools[]
  - stats: { callCount, successRate, humanFallbackCount }

边 (Edge) = 数据流
  - source agent → target agent
  - dataType: 合同 | 回执 | 维修单 | 发票 | 人机消息
  - frequency: 近 7/30 天流转次数
```

## 架构影响（非 UI 层）

| 影响范围 | 变更 |
|---------|------|
| **AgentColonyManager** | 需支持同 `id` 多实例（instanceId），当前以 `id` 为 key 的 Map 结构需调整 |
| **AppDefinition schema** | 新增 `humanFallback` 字段标记缺失 tool → 飞书 fallback 映射 |
| **SkillBridge** | 新增虚拟 skill 生成能力：缺失 tool → 自动生成飞书 send+wait-reply skill |
| **飞书 Channel** | 需封装「同步等待回复」的语义（当前是异步消息模型），可选方案：轮询 + 超时 |
| **ContractChain** | 已有基础（contract-chain.ts），需扩展支持 demo 中的三节点合同链路 |
| **ToolRegistry** | 新增 `getMissingTools(description, tenantTools)` 比对能力，用 Claude 做语义匹配 |
| **StatsCollector** | 新增 per-instance 统计（调用次数、成功率、人工 fallback 次数） |

## 替代方案

### 方案 A: 纯前端 Demo（不涉及后端变更）

前端写死三个 demo agent 数据，生成和优化都是 mock。

**放弃原因**：ADR-001 的演进路径 Phase 2/3 恰好需要这些能力（通讯录路由、人机交互），demo 如果做成假的，后续还是要重新实现，浪费工作量。不如让 demo 直接驱动 Phase 2/3 的真实实现。

### 方案 B: 独立 Demo 项目

在 happycompany 之外新建一个独立项目做 demo。

**放弃原因**：demo 依赖 happycompany 的 corp/、ToolRegistry、AgentColonyManager、飞书 Channel 等核心模块，独立项目要么大量重复代码，要么改造成本更高。

## 实施路径

1. **后端 API 层**：新增 `/api/demo/generate-agent`、`/api/demo/optimize`、`/api/demo/agents` 端点
2. **图谱数据模型**：扩展 stats 和 contract-chain，供图谱查询
3. **前端页面**：在 web/ 下新增 `DigitalEmployees.tsx` + 图谱可视化组件
4. **Demo 数据预置**：在 corp/acme/apps/ 下生成三个 YAML + CLAUDE.md
5. **飞书 fallback skill**：实现虚拟 skill 生成逻辑

## 关联文档

- [ADR-001: 数字员工网络架构](./001-digital-employee-network.md)
- [AppDefinition Schema](../../src/orchestrator/app-schema.ts)
- [AgentColonyManager](../../src/orchestrator/agent-colony.ts)
- [ContractChain](../../src/orchestrator/contract-chain.ts)
