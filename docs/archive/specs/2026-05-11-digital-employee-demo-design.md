# Digital Employee Demo — Design Spec

**日期**: 2026-05-11（2026-05-21 更新——ADR-003 调度员退化）
**状态**: 设计完成（入口路由部分被 [ADR-003](../adr/2026-05-21-003-dispatcher-as-router-fork-instances.md) 取代）
**关联 ADR**: [ADR-002](../adr/2026-05-11-002-digital-employee-demo.md), [ADR-003](../adr/2026-05-21-003-dispatcher-as-router-fork-instances.md)

## 概述

在 happycompany 管理后台新增「数字员工」Demo 页面，支持：
1. 自然语言生成数字员工 agent 配置
2. 技能缺口检测 → Level 1（飞书 Q&A）/ Level 2（表单流程）human fallback
3. 合同为中心的三个 demo agent（销售张三、维修李四、财务王五）
4. 节点/边可视化图谱 + 历史统计
5. Agent fork（一人一 agent，1:1 映射）
6. 一键优化（分析多 agent 配置，沉淀优化后 agent）

## 页面布局

**方案 A（双栏）**：

```
┌──────────────────────┬──────────────────────────┐
│  左侧面板 (380px)      │  右侧面板 (flex:1)         │
│                      │                          │
│  自然语言输入框        │  图谱 / 统计 (Tab 切换)    │
│  生成按钮 + 优化按钮   │                          │
│                      │  ┌─ 节点  ──┐             │
│  Agent 卡片列表       │  │ 张三→合同→李四→王五  │             │
│  · 销售张三 (可fork)   │  │                        │
│  · 维修李四 (可fork)   │  历史统计面板              │
│  · 财务王五 (可fork)   │  调用次数/成功率/fallback  │
│                      │                          │
└──────────────────────┴──────────────────────────┘
```

## 注入安全架构（五层防护）

从自然语言描述到 `AgentColonyManager.register()` 的全链路安全：

```
自然语言
  │
  ▼
Layer 1 — Prompt 约束
  强制 YAML 输出 + Schema 约束说明 + temperature=0.3
  │
  ▼
Layer 2 — 内容修复 (YAML repair)
  提取 YAML → 修正常见问题（代码块/截断/转义）→ parse
  失败 → 返回错误上下文 → 前端展示
  │
  ▼
Layer 3 — Schema 硬校验 (Zod)
  appDefinitionSchema.parse() 不通过 → 拒绝
  错误详情含字段 + 原因 → 前端 highlight
  │
  ▼
Layer 4 — 引用存在性校验
  tools: ToolRegistry 中必须存在 → 缺失进入 fallback 流程
  skills: Skill Factory 确保已安装（或自动生成）
  allowedTargets: AgentColony 中必须存在 → 缺失则移除
  │
  ▼
Layer 5 — 沙箱预览（草稿态）
  校验全通过 → 写入 corp/{tenant}/apps/{agent}.yaml（草稿）
  前端展示 YAML → 用户确认 → 注册到 AgentColonyManager
```

**原则**: 任何一层不通过，不写入 colony。

## Skill Factory（全局共享模式）

```
corp/acme/
├── .claude/
│   └── skills/                    ← tenant 级共享 skill 池
│       ├── human-invoice.md       ← Level 1: 飞书 Q&A
│       ├── human-acceptance.md
│       └── workflow-acceptance-check.md  ← Level 2: 表单流程
├── agents/
│   ├── sales-zhangsan/
│   │   └── .claude/skills/
│   │       └── human-invoice.md → ../../.claude/skills/human-invoice.md (symlink)
│   ├── maintenance-lisi/
│   │   └── .claude/skills/
│   │       └── workflow-acceptance-check.md → symlink
│   └── finance-wangwu/
│       └── .claude/skills/
│           └── human-invoice.md → symlink
```

- Skill Factory 维护全局 skill 注册表
- 新 skill 写入 tenant 级共享目录一次，各 agent 通过 symlink 引用
- 不重复生成同名 fallback skill
- **约束**: Skill 文件必须路径无关（不依赖 `$PWD`，路径从 config 注入）

## Human Fallback 两层模型

### Level 1: 飞书 Q&A（自动生成）

- 触发：缺已知 tool，语义上是简单问答
- 流程：Skill Factory → 生成飞书 skill（发消息 + 轮询等回复）→ 写共享目录 → 建 symlink
- Agent 调用时：飞书发消息给指定用户 → 等回复（超时可配）→ 回复文本作为 tool 返回值

### Level 2: 表单流程（AI 建议 + 创建者确认）

- 触发：缺 tool，语义上是结构化确认（验收、审批、签字）
- 流程：
  1. AI 识别缺口，提示创建者
  2. 创建者可上传现有文档（验收单、工单模板等）→ AI 抽取字段 + 流转逻辑
  3. 创建者确认/调整
  4. 生成 workflow YAML → 封装为 skill → 写入共享目录 → 建 symlink

### Level 2 表单流程定义模型

```yaml
id: "human-workflow:acceptance-check"
name: "进场维修验收"
description: "维修完成后，需医院主任签字确认维修验收"
steps:
  - order: 1
    from: "维修李四"
    to:
      role: "医院主任"
      contactMethod: "feishu"
    action: "send_form"
    form:
      title: "维修验收确认单"
      fields:
        - { name: "deviceStatus", label: "设备运行状态", type: "select", options: ["正常","异常"] }
        - { name: "repairQuality", label: "维修质量评价", type: "select", options: ["满意","一般","不满意"] }
        - { name: "signature", label: "签字确认", type: "signature" }
        - { name: "remark", label: "备注", type: "text" }
    timeout_hours: 48
    onTimeout: "escalate_to_manager"
  - order: 2
    from: "医院主任"
    to: "财务王五"
    action: "auto_forward"
    condition: "step[0].response.deviceStatus == '正常'"
```

## Demo Agent 数据流

```
[销售张三] ──合同──→ [维修李四] ──回执单──→ [财务王五]
    │                    │                    │
    ▼                    ▼                    ▼
 合同情报收集          进场维修执行          合同管理与结算
 合同签署              信息录入              发票管理
                       回执单签署
```

通信方式：Agent 通过 handoff 传递上下文（合同 ID + 状态 + 已收集数据）。

## 图谱可视化

**节点 = Agent 实例**
- id, displayName, role, skills[], tools[]
- stats: { callCount, successRate, humanFallbackCount }

**边 = 数据流**
- source → target agent
- dataType: 合同 | 回执 | 维修单 | 发票 | 人机消息
- frequency: 近 7/30 天流转次数

**Fork 语义**
- 每个数字员工对应一个真实的人（1:1）
- Fork = 复制 agent 配置到新实例 ID
- 图谱中每个节点 = 独立 agent 实例，有独立 session 和统计

## 后端变更范围

| 模块 | 新增/变更 |
|------|----------|
| `src/demo/demo-api.ts` | 新增 — demo API 路由注册 |
| `src/demo/agent-generator.ts` | 新增 — 自然语言解析 + YAML 生成 |
| `src/demo/skill-factory.ts` | 新增 — 全局 skill 生成与安装 |
| `src/demo/form-workflow-generator.ts` | 新增 — Level 2 文档抽取 + 表单流程生成 |
| `src/demo/workflow-doc-extractor.ts` | 新增 — 从上传文档中抽取字段和流转逻辑 |
| `src/demo/agent-optimizer.ts` | 新增 — 多 agent 分析 + 优化建议 |
| `src/orchestrator/agent-colony.ts` | 变更 — 支持同 template 多实例（instanceId） |
| `src/orchestrator/app-schema.ts` | 变更 — 新增 humanFallback 相关字段 |
| `src/workdir.ts` | 变更 — 新增 tenant 级共享 skill 目录管理 + symlink |
| `src/web.ts` | 变更 — 注册 demo 路由 |

## 前端变更范围

| 文件 | 变更 |
|------|------|
| `web/src/pages/DigitalEmployees.tsx` | 新增 — 主页面组件 |
| `web/src/components/graph/AgentGraph.tsx` | 新增 — 节点/边图谱可视化 |
| `web/src/components/graph/GraphStats.tsx` | 新增 — 历史统计面板 |
| `web/src/components/demo/AgentCard.tsx` | 新增 — Agent 卡片（含 fork 按钮） |
| `web/src/components/demo/FormWorkflowBuilder.tsx` | 新增 — Level 2 表单流程配置 |
| `web/src/App.tsx` | 变更 — 添加 /digital-employees 路由 |
| `web/src/components/Layout.tsx` | 变更 — 添加导航项 |
| `web/src/lib/api.ts` | 变更 — 新增 demo API 客户端方法 |
| `web/src/styles/tokens.css` | 变更 — 图谱相关的设计 token |

## Demo 数据预置

在 `corp/acme/` 下生成：
- `apps/sales-zhangsan.yaml` — 销售张三 agent
- `apps/maintenance-lisi.yaml` — 维修李四 agent
- `apps/finance-wangwu.yaml` — 财务王五 agent
- `.claude/skills/human-invoice.md` — 飞书发票 fallback
- `.claude/skills/human-acceptance.md` — 飞书验收 fallback
- `.claude/skills/workflow-acceptance-check.md` — 表单验收流程

## 实施顺序

1. **后端基础**: `agent-generator.ts` + `skill-factory.ts` + 五层安全校验
2. **后端 API**: `demo-api.ts` 路由注册
3. **后端优化器**: `agent-optimizer.ts`
4. **前端页面**: `DigitalEmployees.tsx` + AgentCard + 图谱
5. **Level 2**: `form-workflow-generator.ts` + `workflow-doc-extractor.ts` + FormWorkflowBuilder
6. **Demo 数据**: 预置三个 agent + shared skills
7. **Fork + Colony**: AgentColonyManager 多实例改造
