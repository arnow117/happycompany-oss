# HappyCompany 架构概览

> 最后更新: 2026-05-21
> 分支: main

**更新**: 2026-05-30 — 消息入口已抽出 `MessageIngressRuntime`，Web / 钉钉 / 飞书 / Harness 共用同一条后端消息运行时；Harness fixture 作为平台级验收用例接入测试体系。

## 一句话定位

给不同领域的客户提供可迭代的数字员工平台（通过钉钉/飞书 Bot + Claude Agent），管理员通过独立开发界面做 AI 辅助迭代。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Node.js + TypeScript + Hono + Claude Agent SDK |
| 前端 | React + TypeScript + Vite + Zustand |
| 测试 | Vitest (90 文件, ~1094 测试) + Playwright E2E |
| 数据库 | SQLite (message store, contract store) |
| Python 集成 | 租户应用通过 JSON-RPC 或 CLI 通信 |

## 核心架构

```
                         ┌──────────────────────────────────────────┐
                         │           HappyCompany Server            │
                         │                                          │
  Messaging ◀──────────▶│  Channel Layer                           │
  (DingTalk/Feishu/Web)  │    feishu.ts · dingtalk.ts · web.ts      │
                         │         │                                │
                         │         ▼                                │
                         │  BotManager (routing + dedup)            │
                         │         │                                │
                         │         ▼                                │
                         │  MessageIngressRuntime                   │
                         │    persist · stream · trace · reply      │
                         │         │                                │
                         │         ▼                                │
                         │  Enterprise Routing                      │
                         │    people.json → per-user employee       │
                         │         │                                │
                         │    ┌────┴────┐                           │
                         │    ▼         ▼                           │
                         │  Single    Orchestrated                  │
                         │  Employee  Handoff Loop                  │
                         │    │         │                           │
                         │    ▼         ▼                           │
                         │  ClaudeAgent × N  ──▶  handoff contracts │
                         │    │         │           │               │
                         │    ▼         ▼           ▼               │
                         │  SkillBridge ──▶ MCP Servers ──▶ Tools  │
                         │                                          │
                         │  AuthGate (deny-by-default RBAC)         │
                         │  ToolRegistry (scans tools.json)         │
                         │  EmployeeGenerator (NL → YAML)           │
                         └──────────────────────────────────────────┘
                                    │
                         ┌──────────┴───────────┐
                         │  corp/{tenant}/       │
                         │  ├── employees/*.yaml │  Agent definitions
                         │  ├── .claude/skills/* │  Skill packages + tool manifests
                         │  ├── people.json      │  User directory
                         │  ├── roles.json       │  RBAC policies
                         │  └── agents/*/        │  Employee workspaces
                         └──────────────────────┘
```

## 后端模块结构

```
src/
├── index.ts                     # 主入口，组件组装和启动
├── types.ts                     # 核心类型（NormalizedMessage, BotConfig, RegisteredTool）
├── config.ts                    # 配置加载和热更新
├── agent.ts                     # ClaudeAgent — Session 管理
├── bot.ts                       # BotManager — 消息路由和去重
├── channel.ts                   # ChannelAdapter 接口
├── feishu.ts / dingtalk.ts      # 渠道实现
├── store.ts                     # MessageStore (SQLite)
├── bus.ts                       # MessageBus
├── dedup.ts                     # DedupCache
├── auth-gate.ts                 # 权限控制（角色-工具映射）
├── tenant.ts                    # 租户管理
├── knowledge.ts                 # 知识库集成
├── tool-registry.ts             # 工具注册表（扫描 tools.json）
├── app-server.ts                # Python 应用服务器管理
├── business-api.ts              # 业务 API 路由
├── enterprise-people.ts         # 企业员工管理
├── enterprise-routing.ts        # 企业入口路由（people.json → 员工实例）
├── enterprise-tool-policy.ts    # 企业工具策略
├── scheduler.ts                 # 定时任务调度器
├── memory.ts                    # 记忆管理
├── archiver.ts                  # 会话归档
├── outcome.ts                   # 结果追踪
├── mcp-tools.ts                 # MCP 工具注册
├── sub-agents.ts                # 子 Agent 管理
├── skills.ts                    # 技能加载
├── skill-analytics.ts           # 技能使用统计
├── schemas.ts                   # Zod schemas
├── sanitize.ts                  # 输入清理
├── workdir.ts                   # 工作目录管理
├── web.ts                       # Web 服务器 + 静态文件
├── ws.ts                        # WebSocket
├── ingress/                     # 统一消息入口运行时 + Harness adapter
│   ├── runtime.ts               # MessageIngressRuntime
│   ├── trace-recorder.ts        # IngressTrace 采集
│   └── adapters/harness.ts      # YAML case → Runtime → assertions
├── harness/                     # 长任务 StepRun / Evaluator Gate
├── harness-cli.ts               # Harness CLI (fake + real backend mode)
├── logger.ts                    # 日志
├── crypto.ts                    # 加密
├── commands.ts                  # CLI 命令
├── desc.ts                      # Agent 能力描述生成
├── registry.ts                  # 应用注册表
├── env-guard.ts                 # 环境变量守卫
├── corp-dir.ts                  # corp/ 目录扫描
├── app-runner.ts                # APP 运行器
├── streaming-card.ts            # 钉钉卡片流式推送
├── dingtalk-*.ts                # 钉钉工具函数集
├── feishu-*.ts                  # 飞书工具函数集
├── im-utils.ts                  # IM 通用工具
├── command-utils.ts             # 命令行工具
├── tool-schemas.ts              # 工具模式定义
├── web-app-routes.ts            # Web APP 路由
│
├── orchestrator/                # 编排器模块
│   ├── employee-loader.ts       # YAML → EmployeeDefinition 加载 + 热重载
│   ├── employee-schema.ts       # EmployeeDefinition Zod schema
│   ├── employee-colony.ts       # Agent 群体管理（注册/查找/协议）
│   ├── employee-generator.ts    # NL → YAML Agent 生成器
│   ├── employee-api.ts          # 员工管理 API 路由
│   ├── employee-org.ts          # 员工组织结构
│   ├── skill-bridge.ts          # 工具→MCP 桥接 + 写锁检查
│   ├── write-lock.ts            # 写锁管理（TTL 自动过期）
│   ├── event-bridge.ts          # 事件→Agent 触发桥接
│   ├── handoff-engine.ts        # 动态交接引擎
│   ├── handoff.ts               # 交接协议定义
│   ├── director-router.ts       # 关键词 + LLM 两级路由
│   ├── contract-chain.ts        # 合约链追踪
│   ├── contract-store.ts        # SQLite 合约持久化
│   ├── orchestrator-runner.ts   # 编排器→scheduler/chat 桥接
│   ├── skill-factory.ts         # 技能工厂
│   ├── stats.ts                 # 统计收集（InMemoryStatsStore）
│   ├── trace-store.ts           # 执行轨迹存储
│   ├── context.ts               # 上下文管理
│   ├── config.ts                # 编排器配置
│   ├── types.ts                 # 编排器类型
│   └── errors.ts                # 错误定义
│
├── prompts/                     # Prompt 模板系统
│   ├── index.ts                 # 导出 buildPrompt + PROMPT_IDS
│   ├── loader.ts                # 加载/插值/片段管线
│   ├── templates/               # 按 prompt-id 分目录
│   └── snippets/                # 可复用片段
│
└── routes/                      # API 路由
    ├── admin-config.ts          # 配置管理
    ├── admin-apps.ts            # 应用管理
    ├── admin-operations.ts      # 运维操作
    └── public-routes.ts         # 公开路由
```

## 前端页面

| 页面 | 文件 | 说明 |
|------|------|------|
| Dashboard | Dashboard.tsx | 系统概览 + WebSocket 实时动态 |
| Chat | Chat.tsx | 聊天界面 |
| Config | Config.tsx | 模型配置 + Bot 管理 |
| Setup | Setup.tsx | 首次配置向导 |
| Bots | Bots.tsx | Bot 状态 + 技能 + 应用 |
| Apps | SkillsMarketplace.tsx | 应用注册表管理 |
| Employees | Employees.tsx | 数字员工管理 |
| EnterprisePeople | EnterprisePeople.tsx | 企业员工绑定 |
| Sessions | Sessions.tsx | 会话管理 |
| Stats | Stats.tsx | 使用统计 |
| Scheduler | Scheduler.tsx | 定时任务 |
| KnowledgeBase | KnowledgeBase.tsx | 知识库 |
| Memory | Memory.tsx | 记忆管理 |
| AgentStatus | AgentStatus.tsx | Agent 状态监控 |
| Orchestration | Orchestration.tsx | 编排 Trace 与员工交接观察 |
| Onboarding | Onboarding.tsx | 引导页 |
| Login | Login.tsx | 登录 |
| NotFound | NotFound.tsx | 404 |

## 数据流

### 用户消息处理

```
用户消息 (钉钉/飞书/Web)
  → ChannelAdapter 解析为 NormalizedMessage
    → BotManager (去重 + 路由)
      → MessageIngressRuntime (消息入库 + stream + IngressTrace)
      → EnterpriseRouting (查 people.json 绑定)
        → 找到绑定的数字员工 → fork/直连实例
        → 无绑定 → 提示去 /people 绑定
      → ClaudeAgent.respond()
        → MCP 工具执行 (SkillBridge → AppServer)
        → Agent 间 handoff (HandoffEngine → DirectorRouter)
      → 格式化响应 → Channel 发送
```

### Agent 间交接

```
Agent A → handoff MCP tool → DirectorRouter (keyword → LLM fallback)
  → Contract { parentId, status } → SQLite persistence
  → 目标 Agent 执行 → 结果回传
```

### Harness 验收

```
tests/fixtures/harness/*.yaml
  → src/harness-cli.ts --fake
    → MessageIngressRuntime + fake AgentFactory
    → IngressTrace assertions

tests/fixtures/harness/*.yaml
  → src/harness-cli.ts --server-url http://127.0.0.1:3100
    → /api/admin/harness/run
    → 运行中服务的真实 AgentFactory
    → IngressTrace assertions
```

Harness story 覆盖矩阵见 [2026-05-31-harness-story-coverage-map.md](2026-05-31-harness-story-coverage-map.md)。fixture 当前分层：

| 层 | 用途 |
|---|---|
| Runtime smoke | 确认 Web / IM / Harness 形态都能产出同一类 `IngressTrace` |
| Binding / selector | 覆盖人与数字员工绑定、员工选择器、未绑定保护 |
| Business tools | 覆盖医疗 CRM、平台运维、专业服务模板租户等业务工具调用 |
| Collaboration | 覆盖 memory、handoff、多员工协作链路和事件入口 |
 
本地确定性回归：

```bash
npm run harness:fake
```

真实链路 smoke：

```bash
npm run dev
npm run harness:real -- --server-url http://127.0.0.1:3100 --admin-token "$HAPPYCOMPANY_ADMIN_TOKEN"
```

Web 管理入口 `/harness` 会调用：

| API | 用途 |
|---|---|
| `GET /api/admin/harness/cases` | 列出固定 fixture 目录下的验收用例 |
| `POST /api/admin/harness/run-suite` | 在运行中后端执行选定 case 或全量 suite |
| `GET /api/admin/harness/reports/latest` | 查看最近一次 suite 报告 |

## 租户目录结构

```
corp/{tenant}/
├── app.json              # 企业元数据
├── roles.json            # 角色-工具权限
├── people.json           # 员工→数字员工绑定 (gitignored)
├── employees/            # 数字员工定义
│   └── {employee}.yaml
├── agents/               # 数字员工 workspace
└── .claude/skills/       # 企业 skill package
    └── {skill}/
        ├── SKILL.md      # 模型可读说明
        ├── tools.json    # 工具清单、schema、riskLevel、server metadata
        └── {skill}/      # Python/业务工程代码
```

## API 端点

### 管理 API (需 Token)

| 路径 | 说明 |
|------|------|
| `/api/admin/config` | 配置读写 |
| `/api/admin/bots/{name}/*` | Bot 管理 |
| `/api/admin/skills` | 技能管理 |
| `/api/admin/workdir/*` | 工作目录 |
| `/api/admin/scheduler/tasks` | 调度任务 |
| `/api/admin/memory/{bot}/*` | 记忆管理 |

### 业务 API

| 路径 | 说明 |
|------|------|
| `/api/business/agents` | Agent 列表 |
| `/api/business/colony` | Colony 管理 |
| `/api/business/stats` | 使用统计 |
| `/api/business/contract-chain` | 合约链 |
| `/api/business/locks` | 写锁状态 |
| `/api/enterprise-people/*` | 企业员工管理 |

### 公开 API

| 路径 | 说明 |
|------|------|
| `/api/health` | 健康检查 |
| `/api/setup/status` | 配置状态 |
| `/api/login` | 登录 |

## 端口

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 (Vite) | 8888 | 开发时 HMR |
| 后端 (Hono) | 3100 | API + 静态文件服务 |

## 关联文档

| 文件 | 内容 |
|------|------|
| [ADR-002: 数字员工 Demo](../adr/2026-05-11-002-digital-employee-demo.md) | 数字员工系统设计 |
| [ADR-003: 调度员退化](../adr/2026-05-21-003-dispatcher-as-router-fork-instances.md) | 调度器从 Agent 退化为纯路由层 |
| [Agent Dreaming Design](2026-05-21-agent-dreaming-design.md) | Agent 自动学习/优化设计 |
| [钉钉企业路由 Runbook](../reports/2026-05-18-dingtalk-enterprise-routing-runbook.md) | 钉钉企业入口冷启动流程 |
