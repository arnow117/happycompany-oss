# HappyCompany 架构概览

> 生成时间: 2026-05-10
> 版本: v1.0
> 代码库: `happycompany/`

## 一、项目定位

HappyCompany 是一个统一的 AI Agent 平台，提供以下核心能力：

1. **多租户支持**: 通过 `corp/` 目录组织不同租户（如 `acme/`）
2. **Agent 群体管理**: 通过 APP YAML 配置定义和调度多个协作 Agent
3. **技能桥接**: 将租户应用（Skills）桥接到 Agent 的 MCP 工具系统
4. **权限控制**: 基于 `roles.json` 的角色-工具权限管理
5. **可观测性**: 统计收集、写锁管理、合约链追踪
6. **Web 界面**: React 前端 + Hono 后端的管理控制台

## 二、模块依赖关系

### 2.1 核心模块

```
index.ts (主入口)
├── config.ts
├── logger.ts
├── bot.ts → BotManager
├── agent.ts → ClaudeAgent
├── store.ts → MessageStore
├── bus.ts → MessageBus
├── dedup.ts → DedupCache
├── memory.ts → MemoryManager
├── archiver.ts → ConversationArchiver
├── scheduler.ts → TaskScheduler
├── web.ts → startWebServer
├── feishu.ts / dingtalk.ts → ChannelAdapter
├── workdir.ts → loadWorkdir, initWorkdir
├── desc.ts → generateCapabilityDesc, extractBotDescription
├── daily-summary.ts
├── auth-gate.ts → AuthGate
├── tenant.ts → TenantMgr
├── knowledge.ts → searchOpenViking, buildKnowledgeMcpServer
├── tool-registry.ts → ToolRegistry
├── tool-schemas.ts
├── app-server.ts → AppServerMgr
├── business-api.ts → registerBusinessRoutes
└── orchestrator/ (编排器模块)
    ├── employee-loader.ts → EmployeeLoader
    ├── employee-schema.ts
    ├── skill-bridge.ts → SkillBridge
    ├── employee-colony.ts → EmployeeManager
    ├── write-lock.ts → WriteLockManager
    ├── stats.ts → StatsCollector, InMemoryStatsStore
    ├── contract-chain.ts → ContractChainTracker
    ├── event-bridge.ts → EventBridge
    ├── platform-admin.ts → buildPlatformAdminTools
    ├── handoff-engine.ts → DynamicHandoffOrchestrator
    ├── handoff.ts
    ├── types.ts
    ├── context.ts
    ├── errors.ts
    └── config.ts
```

### 2.2 Web 前端模块

```
web/src/
├── App.tsx
├── main.tsx
├── index.css
├── lib/
│   └── api.ts (API 客户端)
├── pages/ (页面组件)
│   ├── Processes.tsx (流程管理)
│   ├── ... (其他页面)
├── components/ (UI 组件)
├── hooks/ (React Hooks)
├── stores/ (状态管理)
└── types/ (类型定义)
```

## 三、数据流图

### 3.1 用户请求处理流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 用户请求                                                         │
│ (飞书/钉钉消息 | Web 界面操作)                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ ChannelAdapter (FeishuChannel | DingTalkChannel)               │
│ - 消息接收与格式化                                               │
│ - 触发 BotManager.onMessage                                     │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ BotManager                                                      │
│ - 消息去重 (DedupCache)                                         │
│ - 消息存储 (MessageStore)                                        │
│ - 路由到 agentFactory.respond()                                 │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ agentFactory.respond()                                          │
│ 1. 查找或创建 ClaudeAgent                                       │
│ 2. 构建 MCP Servers:                                            │
│    - platform (平台工具: get_inbox, list_inbox, scheduler)       │
│    - app-tools (SkillBridge 构建的租户工具)                     │
│    - tenant-tools (租户工具懒加载)                               │
│ 3. 构建权限钩子 (canUseTool):                                   │
│    - AuthGate.checkSkill() (技能级权限)                         │
│    - AuthGate.checkBashCommand() (工具级权限)                    │
│ 4. 调用 agent.respond(prompt, chatId, opts)                    │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ ClaudeAgent                                                     │
│ - 加载 Agent Session                                            │
│ - 调用 Claude Agent SDK                                         │
│ - 执行 MCP 工具                                                 │
│ - 返回响应                                                       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ SkillBridge (MCP 工具执行)                                      │
│ - 解析工具模式匹配                                               │
│ - 调用 AppServerMgr.call() 或 callCli()                         │
│ - 可选写锁检查 (WriteLockManager)                               │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ AppServerMgr (Python 应用服务器管理)                            │
│ - JSON-RPC 通信                                                 │
│ - 调用租户应用提供的工具                                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 租户应用 (Python CLI / Server)                                   │
│ - med_crm, 等应用                                                │
│ - 执行业务逻辑并返回结果                                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 响应返回                                                         │
│ - 格式化响应                                                     │
│ - 发送回 Channel (飞书/钉钉/Web)                                 │
│ - 归档会话 (ConversationArchiver)                               │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Agent Colony 初始化流程

```
启动
  │
  ▼
ToolRegistry.scan()
  - 扫描 corp/{tenant}/apps/ 下的 tools.json
  - 解析 ToolManifest 并注册工具
  │
  ▼
AuthGate 加载 roles.json
  - 为每个租户加载角色定义
  │
  ▼
EmployeeLoader.load()
  - 扫描 corp/{tenant}/employees/*.yaml
  - 解析数字员工 YAML 配置 (EmployeeDefinition)
  │
  ▼
EmployeeManager.registerAll()
  - 为每个 EmployeeDefinition 创建 ClaudeAgent
  - 包装为 AgentProtocol
  │
  ▼
EventBridge.registerEmployeeEventTriggers()
  - 注册事件触发器到 MessageBus
  - 事件 → Agent 执行
  │
  ▼
完成
```

## 四、核心接口与类型

### 4.1 类型定义 (src/types.ts)

```typescript
// 消息源类型
type MessageSource = 'user' | 'bot' | 'self';

// 文件附件
interface FileAttachment {
  type: 'file' | 'image';
  name: string;
  localPath: string;
  mimeType?: string;
  textContent?: string;
  base64?: string;
}

// 标准化消息
interface NormalizedMessage {
  id: string;
  chatId: string;
  text: string;
  source: MessageSource;
  channelId: string;
  fromBotName?: string;
  receivedAt: number;
  fromUserId?: string;
  createTimeMs?: number;
  threadId?: string;
  rootId?: string;
  parentId?: string;
  chatType?: 'group' | 'p2p';
  mentions?: Array<{ ... }>;
  replyTo?: { ... };
  files?: FileAttachment[];
}

// Bot 配置
interface BotConfig {
  name: string;
  channel: 'feishu' | 'dingtalk' | 'web';
  credentials?: Record<string, string>;
  displayName: string;
  reactionEmoji?: string;
  agentDir: string;
  cwd?: string;
  model?: string;
  baseUrl?: string;
  authToken?: string;
}

// 注册的工具
interface RegisteredTool extends ToolDef {
  namespacedName: string;  // "appName:toolName"
  appName: string;
  tenantName: string;
  hasServer: boolean;
}

// App 摘要
interface AppSummary {
  name: string;
  displayName: string;
  description: string;
  toolCount: number;
  hasServer: boolean;
}
```

### 4.2 工具模式定义 (src/tool-schemas.ts)

```typescript
// 风险等级
type RiskLevel = 'read' | 'internal_write' | 'external' | 'destructive';

// 工具定义
interface ToolDef {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// 工具清单 (tools.json)
interface ToolManifest {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  tools: ToolDef[];
  server?: {
    entry: string;
    python?: string;
  };
}

// 应用配置 (app.json)
interface AppJson {
  displayName?: string;
  description?: string;
  model?: string;
  budget?: {
    dailyTokenLimit?: number;
    maxTokensPerQuery?: number;
  };
  outcomeSignals?: {
    positive?: string[];
    negative?: string[];
  };
  followup?: { ... };
  contextCompaction?: { ... };
}

// 角色配置 (roles.json)
interface RolesJson {
  roles: Record<string, {
    displayName: string;
    tools: '*' | string[];
  }>;
  users?: Record<string, string>;
}
```

### 4.3 AppDefinition (APP YAML)

```typescript
// src/orchestrator/app-schema.ts
interface AppDefinition {
  id: string;                    // Agent ID
  displayName: string;           // 显示名称
  description?: string;
  model?: string;                // 覆盖全局模型
  systemPrompt?: string;         // 系统 Prompt
  maxTurns?: number;             // 最大轮次
  tools: string[];               // 工具模式列表 (如 ["med_crm:search_*"])
  skills: string[];              // 技能列表 (如 ["med_crm"])
  workspace?: string;            // 工作目录
  role: string;                  // Agent 角色
  schedule?: {
    triggers: Array<{
      type: 'cron' | 'interval' | 'once' | 'event';
      value: string;
      prompt: string;
      enabled?: boolean;
    }>;
  };
  allowedTargets?: string[];     // 允许的交接目标
  retry?: { ... };
  channel?: 'dingtalk' | 'feishu';
  channelConfig?: Record<string, unknown>;
}
```

### 4.4 CallerContext (调用上下文)

```typescript
// src/orchestrator/skill-bridge.ts
interface CallerContext {
  agentId: string;   // Agent ID
  role: string;      // Agent 角色
  owner?: string;    // 所有者
}
```

## 五、Orchestrator 组件详解

### 5.1 EmployeeLoader (employee-loader.ts)

**职责**: 加载和管理数字员工 YAML 配置

**关键方法**:
- `load()`: 扫描 `corp/{tenant}/employees/*.yaml`，解析并验证配置
- `loadTenant(tenantName)`: 加载单个租户的数字员工配置
- `reload(previous)`: 热重载，返回增删改变更

**输出**: `LoadedEmployee[]` (扩展自 `EmployeeDefinition`)

### 5.2 SkillBridge (skill-bridge.ts)

**职责**: 将租户工具桥接到 Agent 的 MCP 工具系统

**核心功能**:
1. **工具解析**: `resolveTools(app, tenantName)` - 解析 EmployeeDefinition 中的工具模式
2. **技能展开**: `expandSkills(skills, tenantTools)` - 将技能名展开为所有相关工具
3. **MCP 构建**: `buildMcpTools()` - 将工具转换为 SDK MCP 工具定义
4. **执行处理**: 包含写锁检查、AppServer 调用

**工具执行流程**:
```
Agent 调用工具
  → SkillBridge 工具处理器
    → 写锁检查 (WriteLockManager)
    → AppServerMgr.call() (Server 模式) 或 callCli() (CLI 模式)
    → 返回结果
```

### 5.3 EmployeeManager (employee-colony.ts)

**职责**: 管理多个协作 Agent 的生命周期

**核心功能**:
- `register(app)`: 注册单个 Agent (创建 ClaudeAgent + AgentProtocol)
- `registerAll(apps)`: 批量注册
- `getAgent(appId)`: 获取 ClaudeAgent 实例
- `getAppMcpServer(appId, callerContext)`: 获取 Agent 的 MCP Server
- `getProtocols()`: 获取所有 AgentProtocol (用于编排器)

**工作空间解析**:
- `workspace` 字段优先: `corp/{tenant}/{workspace}`
- 默认: `corp/{tenant}/agents/{appId}`
- CWD: `corp/{tenant}/`

### 5.4 WriteLockManager (write-lock.ts)

**职责**: 管理写锁，防止并发修改

**核心方法**:
- `acquire(req)`: 获取锁 (支持过期时间)
- `release(entity, entityId, lockedBy)`: 释放锁
- `isLocked()`: 检查锁状态
- `getAgentLocks(agentId)`: 获取 Agent 持有的锁

**锁结构**:
```typescript
interface WriteLock {
  entity: string;      // 实体名 (通常是工具名)
  entityId: string;    // 实体 ID (通常是 Agent ID)
  lockedBy: string;    // 锁持有者 (Agent ID)
  lockedAt: number;    // 锁定时间
  expiresAt: number;   // 过期时间
}
```

### 5.5 StatsCollector (stats.ts)

**职责**: 收集和统计 Agent 运行数据

**核心接口**:
```typescript
interface StatsStore {
  recordTokenUsage(event: TokenUsageEvent & { timestamp }): void;
  recordAgentRun(event: AgentRunEvent & { timestamp }): void;
  getAgentStats(agentId: string): AgentStats;
  listAllAgentStats(): AgentStats[];
  getStatsForRange(from, to): AgentStats[];
}

interface AgentStats {
  agentId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  runCount: number;
  failureCount: number;
  lastRunAt: number;
}
```

**实现**: `InMemoryStatsStore` (内存存储)

### 5.6 ContractChainTracker (contract-chain.ts)

**职责**: 追踪合约执行链路 (Agent 间的调用关系)

**核心接口**:
```typescript
interface ChainEvent {
  contractId: string;
  agentId: string;
  action: string;
  detail?: string;
  targetAgent?: string;
}

interface ChainStore {
  addEvent(event: ChainEntry): void;
  getChain(contractId: string, agentId?: string): ChainEntry[];
  listContractsWithActivity(from, to): string[];
}
```

**实现**: `InMemoryChainStore` (内存存储)

### 5.7 EventBridge (event-bridge.ts)

**职责**: 连接领域事件到 Agent 执行

**核心流程**:
```
APP YAML 定义事件触发器 (schedule.triggers[*].type === 'event')
  → EventBridge.registerEmployeeEventTriggers()
    → MessageBus 订阅领域事件
      → 事件触发 → agent.respond(prompt, chatId, agentId)
```

### 5.8 PlatformAdmin (platform-admin.ts)

**职责**: 构建平台级管理工具 (通过 MCP 暴露给 Agent)

**可用工具**:
- `agent_status`: 列出所有 Agent 统计
- `write_lock_status`: 列出当前持有的写锁
- `contract_chain`: 获取合约执行链
- `list_contracts`: 列出有时间范围内活动的合约

## 六、前端-后端连接

### 6.1 API 端点分类

**管理端 API** (`/api/admin/*`):
- Bots 管理: `/api/admin/bots/{name}/*`
- Apps 管理: `/api/admin/apps/*`
- Skills 管理: `/api/admin/skills`
- Workdir 管理: `/api/admin/workdir/*`
- 调度器: `/api/admin/scheduler/tasks`
- 构建: `/api/admin/build/*`
- 分析: `/api/admin/analytics/*`
- 记忆: `/api/admin/memory/{bot}/*`

**业务端 API** (`/api/business/*`):
- Agents: `/api/business/agents`
- Channels: `/api/business/channels`
- Contract Chain: `/api/business/contract-chain`
- Stats: `/api/business/stats`
- Locks: `/api/business/locks`
- Colony: `/api/business/colony`

### 6.2 前端 API 客户端 (web/src/lib/api.ts)

```typescript
export const api = {
  // 认证
  login: (token: string) => Promise<void>,

  // 健康检查
  health: () => Promise<HealthResponse>,

  // 聊天
  listChats: () => Promise<ChatSummary[]>,

  // 应用管理
  listApps: () => Promise<AppInfo[]>,
  getApp: (name: string) => Promise<AppInfo>,
  publishApp: (body) => Promise<AppInfo>,
  // ...

  // 技能管理
  listSkills: () => Promise<SkillInfo[]>,

  // Bot 管理
  clearBotSessions: (name: string) => Promise<{ cleared: number }>,
  // ...

  // 业务 API
  listBusinessAgents: () => Promise<{ agents: BusinessAgent[] }>,
  getContractChain: () => Promise<{ ... }>,
  // ...
};
```

### 6.3 Processes 页面示例 (Processes.tsx)

**功能**: 流程实例管理 (蓝图/实例/节点状态)

**关键交互**:
- 创建实例: `POST /api/admin/processes/{bot}/instances`
- 启动节点: `POST /api/admin/processes/{bot}/instances/{id}/start`
- 完成节点: `POST /api/admin/processes/{bot}/instances/{id}/complete`
- 取消实例: `POST /api/admin/processes/{bot}/instances/{id}/cancel`

## 七、关键配置文件

### 7.1 目录结构

```
happycompany/
├── src/                          # 后端源码
│   ├── index.ts                 # 主入口
│   ├── types.ts                 # 核心类型
│   ├── tool-registry.ts         # 工具注册表
│   ├── tool-schemas.ts          # 工具模式定义
│   ├── auth-gate.ts             # 权限控制
│   ├── tenant.ts                # 租户管理
│   ├── knowledge.ts             # 知识库集成
│   ├── outcome.ts               # 结果追踪
│   ├── app-server.ts            # 应用服务器管理
│   ├── business-api.ts          # 业务 API
│   └── orchestrator/            # 编排器模块
│       ├── app-loader.ts        # APP YAML 加载器
│       ├── app-schema.ts        # APP 模式定义
│       ├── skill-bridge.ts      # 技能桥接
│       ├── agent-colony.ts      # Agent 群体管理
│       ├── write-lock.ts        # 写锁管理
│       ├── stats.ts             # 统计收集
│       ├── contract-chain.ts    # 合约链追踪
│       ├── event-bridge.ts      # 事件桥接
│       ├── platform-admin.ts    # 平台管理工具
│       ├── handoff-engine.ts    # 交接引擎
│       └── ...
├── web/                         # 前端源码
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── lib/
│       │   └── api.ts           # API 客户端
│       └── pages/
│           └── Processes.tsx    # 流程管理页面
├── corp/                        # 租户目录
│   └── {tenant}/                # 租户 (如 acme/)
│       ├── app.json             # 应用配置
│       ├── roles.json           # 角色配置
│       ├── apps/                # 应用目录
│       │   ├── {app}/           # 应用 (如 med_crm/)
│       │   │   ├── tools.json   # 工具清单
│       │   │   ├── {app}.yaml   # APP YAML 配置
│       │   │   └── ...
│       └── agents/              # Agent 工作目录
└── config.json                  # 全局配置
```

### 7.2 配置文件示例

**tools.json** (应用工具清单):
```json
{
  "name": "med_crm",
  "displayName": "医疗 CRM",
  "description": "医院客户关系管理工具",
  "tools": [
    {
      "name": "search_hospitals",
      "description": "搜索医院信息",
      "riskLevel": "read",
      "parameters": {
        "type": "object",
        "properties": {
          "keyword": { "type": "string" }
        }
      }
    }
  ],
  "server": {
    "entry": "server.py",
    "python": "python3"
  }
}
```

**roles.json** (角色权限配置):
```json
{
  "roles": {
    "admin": {
      "displayName": "管理员",
      "tools": "*"
    },
    "sales": {
      "displayName": "销售",
      "tools": ["med_crm:search_*", "med_crm:list_*"]
    }
  },
  "users": {
    "user_123": "sales",
    "user_456": "admin"
  }
}
```

**{app}.yaml** (APP YAML 配置):
```yaml
id: med_crm_assistant
displayName: 医疗 CRM 助手
description: 帮助管理医院客户信息
role: 客户经理
model: claude-sonnet-4.6-20250514
systemPrompt: 你是一个专业的医疗 CRM 助手...
maxTurns: 50
tools:
  - "med_crm:*"
skills:
  - med_crm
workspace: .
schedule:
  triggers:
    - type: cron
      value: "0 9 * * 1-5"
      prompt: 生成今日客户跟进清单
      enabled: true
allowedTargets:
  - data_assistant
```

## 八、安全与权限

### 8.1 权限控制流程

```
工具调用
  │
  ▼
canUseTool hook (SDK)
  │
  ├─ Skill 调用?
  │   ├─ AuthGate.checkSkill(skillName, tenantName, userId)
  │   │   ├─ 解析用户角色
  │   │   ├─ 检查角色是否允许该技能
  │   │   └─ 返回 allow/deny
  │   └─ ...
  │
  ├─ Bash 调用?
  │   ├─ AuthGate.checkBashCommand(command, tenantName, userId, toolRegistry)
  │   │   ├─ 解析命令匹配的工具模式
  │   │   ├─ 检查角色是否允许该工具
  │   │   └─ 返回 allow/deny
  │   └─ ...
  │
  └─ 其他操作? → allow
```

### 8.2 写锁机制

**应用场景**: 防止多个 Agent 同时修改同一资源

**工作流程**:
```
Agent A 调用写操作工具
  │
  ▼
WriteLockManager.acquire({ entity, entityId, lockedBy })
  │
  ├─ 锁可用? → 获取锁，继续执行
  │
  └─ 锁被占用? → 返回拒绝，告知持有者
```

## 九、可观测性

### 9.1 统计指标

| 指标 | 说明 |
|------|------|
| `totalInputTokens` | 总输入 Token 数 |
| `totalOutputTokens` | 总输出 Token 数 |
| `callCount` | 工具调用次数 |
| `runCount` | Agent 运行次数 |
| `failureCount` | 失败次数 |
| `lastRunAt` | 最后运行时间 |

### 9.2 合约链追踪

追踪 Agent 间的调用关系，用于审计和调试：

```
contractId: contract_123
  [ts1] agent_a → action: handoff → target: agent_b
  [ts2] agent_b → action: execute_tool → detail: med_crm:search
  [ts3] agent_b → action: handoff → target: agent_c
  [ts4] agent_c → action: complete
```

## 十、扩展点

### 10.1 添加新的租户应用

1. 在 `corp/{tenant}/apps/` 创建应用目录
2. 编写 `tools.json` 定义工具
3. 编写 `APP.yaml` 定义 Agent 配置
4. （可选）编写 Python 服务器实现工具逻辑

### 10.2 添加新的 Channel

1. 实现 `ChannelAdapter` 接口
2. 在 `index.ts` 的 `createChannel()` 中添加分支
3. 实现消息接收和发送逻辑

### 10.3 添加新的 Orchestrator 组件

在 `orchestrator/` 目录下创建新模块，遵循现有模式：
- 使用 Zod 定义输入/输出模式
- 实现类和方法
- 在 `index.ts` 中集成

---

**文档版本**: 1.0
**最后更新**: 2026-05-10
**维护者**: arnow117
