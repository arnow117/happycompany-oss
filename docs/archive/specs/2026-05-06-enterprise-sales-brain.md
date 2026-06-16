# 企业销售大脑平台 — 平台层 v1 方案

> 日期：2026-05-06
> 状态：设计完成，待评审
> 范围：happycompany 平台层改造，corp/acme 作为验证案例

---

## 1. 目标

将 happycompany 从"单一企业 Bot 托管平台"升级为"多企业销售大脑平台"，支持：

- 多企业隔离接入（corp/{name}/ 模式）
- 企业 APP 以声明式 Tool Manifest 接入（替代当前 shell-out CLI 模式）
- 用户级权限控制
- 统一知识库引擎
- 业务反馈闭环

---

## 2. 整体架构

### 2.1 原始设计（概念模型）

```
┌──────────────────────────────────────────────────────────────┐
│                    happycompany 平台层                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ IM 渠道   │  │ BotMgr   │  │ Agent    │  │ Web Admin  │  │
│  │ feishu   │  │ 路由/去重 │  │ SDK封装  │  │ 仪表盘/聊天 │  │
│  │ dingtalk │  │          │  │          │  │            │  │
│  └──────────┘  └──────────┘  └────┬─────┘  └────────────┘  │
│                                   │                         │
│  ┌────────────────────────────────┼──────────────────────┐  │
│  │            新增模块 (v1)         │                      │  │
│  │  ┌─────────────┐  ┌───────────┴────┐  ┌───────────┐  │  │
│  │  │ToolRegistry │  │  AppServerMgr │  │ TenantMgr │  │  │
│  │  │ tool发现/注册│  │  JSON-RPC管理 │  │ 多企业隔离  │  │  │
│  │  └─────────────┘  └───────────────┘  └───────────┘  │  │
│  │  ┌─────────────┐  ┌───────────────┐  ┌───────────┐  │  │
│  │  │KnowledgeBase│  │ OutcomeTrack  │  │ AuthGate  │  │  │
│  │  │ 向量检索引擎 │  │ 反馈闭环      │  │ 审批+预算  │  │  │
│  │  └─────────────┘  └───────────────┘  └───────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  不改: channel bot store bus web scheduler memory archiver   │
└──────────────────────────┬───────────────────────────────────┘
                           │ JSON-RPC over stdio / CLI 降级
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         corp/acme  corp/foo    corp/bar
```

### 2.2 实现架构（实际模块 + Claude SDK Harness）

```
                              用户消息
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
               IM 渠道     WebSocket      Web Admin
              (feishu/    (浏览器       (仪表盘/
               dingtalk)    聊天)          聊天)
                    │            │            │
                    └────────────┼────────────┘
                                 │
                           ┌─────▼─────┐
                           │  BotMgr   │  路由 / 去重 / session 管理
                           └─────┬─────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Claude Agent SDK      │  @anthropic-ai/claude-agent-sdk
                    │   (agent.ts)            │
                    │                         │
                    │  mcpServers: {          │  ── SDK options 注入 MCP Server
                    │    platform: {...},     │
                    │    'tenant-tools': {...}│
                    │  }                      │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                   ▼
     ┌────────────────┐ ┌──────────────┐  ┌──────────────────┐
     │ Platform MCP   │ │ Tenant MCP  │  │ Claude API       │
     │ Server         │ │ Server       │  │ (实际推理)       │
     │ (mcp-tools.ts) │ │(mcp-tools.ts)│  │                  │
     │                │ │              │  │  system prompt   │
     │ 6 tools:       │ │ 2 tools:     │  │  = agentDir CLAUDE.md
     │  memory_search │ │ app_summary  │  │  + app.json 压缩 │
     │  memory_save   │ │ load_tools   │  │  + knowledge ctx │
     │  knowledge_    │ │              │  │                  │
     │    search      │ │  渐进式披露:  │  │                  │
     │  get_stats     │ │  先看摘要 →   │  │                  │
     │  get_time      │ │  按需加载详情 │  │                  │
     │  list_bots     │ │              │  │                  │
     └────────────────┘ └──────┬───────┘  └──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
     ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
     │ToolRegistry  │ │ AuthGate     │  │TenantMgr     │
     │(tool-registry│ │(auth-gate.ts)│  │(tenant.ts)   │
     │    .ts)      │ │              │  │              │
     │              │ │ role 白名单   │  │ corp/{name}/ │
     │ Zod 校验     │ │ risk 等级门   │  │ 扫描 + 隔离  │
     │ tools.json   │ │ token 预算    │  │ agentDir 映射 │
     │ 命名空间管理  │ │              │  │              │
     └──────┬───────┘ └──────────────┘  └──────────────┘
            │
            ▼
     ┌──────────────┐     ┌──────────────┐
     │AppServerMgr  │     │Knowledge     │
     │(app-server.ts)│    │(knowledge.ts)│
     │              │     │              │
     │ Python 子进程 │     │ OpenViking   │
     │ JSON-RPC     │     │ 127.0.0.1:   │
     │ stdin/stdout │     │   1933       │
     │ CLI 降级     │     │ hybrid 检索  │
     └──────┬───────┘     └──────────────┘
            │
            ▼
     ┌──────────────┐     ┌──────────────┐
     │OutcomeTracker│     │ Session      │
     │(outcome.ts)  │     │ Mining       │
     │              │     │ (TODO v2)    │
     │ outcome_log  │     │              │
     │ 关键词信号   │     │ 对话挖掘     │
     │ 反馈按钮     │     │ 模式识别     │
     └──────────────┘     └──────────────┘

               ┌────────────┼────────────┐
               ▼            ▼            ▼
          corp/acme  corp/foo    corp/bar
```

#### 核心概念: Agent = Bot 运行时上下文

```
Agent 不独立存在，它由 Bot 的运行时上下文定义：

  agentDir (persona)  +  cwd (workdir)  =  Agent 身份
  ──────────────────     ────────────     ─────────────
  corp/acme/         corp/acme/     "示例医疗 Agent"
    CLAUDE.md             med_crm/
    app.json              server.py
    roles.json            data/crm.db

corp 侧 = 声明式（配置文件、权限、预算）
workdir 侧 = 运行时（代码、数据、子进程）

workdir 中的 APP ≈ Agent 能力定义
（同一个东西的两个视角）
```

### 企业目录结构

```
corp/{name}/
├── app.json              # 企业元信息 + 预算配置 + 压缩 prompt
├── roles.json            # 角色定义 + 用户-角色映射
├── apps/                 # 企业 APP 定义
│   └── {app_name}/
│       ├── tools.json    # Tool 声明 (P0)
│       ├── server.py     # 可选：长驻 JSON-RPC 进程
│       └── ...           # 现有代码原样保留
├── data/                 # 企业专属数据
│   ├── crm.db            # 业务数据库
│   ├── knowledge/        # 向量索引 + 文档缓存
│   └── messages.db       # 平台消息存储（每个企业独立）
└── import/               # 原始导入文件
```

---

## 3. 新增模块清单

| 模块 | 文件 | 职责 | 新建/改 |
|------|------|------|---------|
| ToolRegistry | `src/tool-registry.ts` | 扫描 `corp/*/apps/*/tools.json`，注册 tool 定义，按企业命名空间管理 | 新建 |
| AppServerMgr | `src/app-server.ts` | 管理 Python 子进程生命周期（启动/重启/健康检查），JSON-RPC over stdio，连接池复用 | 新建 |
| TenantMgr | `src/tenant.ts` | 多企业目录扫描、dataDir 分配、企业边界校验 | 新建 |
| AuthGate | `src/auth-gate.ts` | 用户级 tool 权限校验（基于 roles.json），审批门（对外/破坏性操作确认），预算控制 | 新建 |
| KnowledgeBase | `src/knowledge.ts` | 向量化、索引、语义检索、多模态 ingestion（替代独立 OpenViking） | 新建 |
| OutcomeTracker | `src/outcome.ts` | 反馈采集、对话信号识别、回访调度 | 新建 |
| Agent | `src/agent.ts` | 注入注册的 APP tool 到 SDK options，替换裸 Bash 调用 | 改 ~30 行 |
| Index | `src/index.ts` | main() 启动时初始化 ToolRegistry + TenantMgr + AppServerMgr | 改 ~15 行 |
| MessageStore | `src/store.ts` | 追加 outcome_log 表 + token 计数 | 改 ~20 行 |

---

## 4. Tool Manifest 协议 (P0)

### 4.1 tools.json 格式

```json
{
  "name": "med_crm",
  "version": "1.0.0",
  "displayName": "医院CRM",
  "description": "医疗器械销售 CRM",
  "tools": [
    {
      "name": "search_hospitals",
      "description": "搜索医院，支持按省份/城市/渠道过滤",
      "riskLevel": "read",
      "parameters": {
        "type": "object",
        "properties": {
          "keyword": { "type": "string", "description": "医院名称关键词" },
          "province": { "type": "string" },
          "city": { "type": "string" },
          "channel": { "type": "string" }
        }
      }
    },
    {
      "name": "delete_hospital",
      "description": "删除医院记录",
      "riskLevel": "destructive",
      "parameters": {
        "type": "object",
        "properties": {
          "id": { "type": "integer" }
        },
        "required": ["id"]
      }
    }
  ],
  "server": {
    "entry": "server.py",
    "python": "3.12"
  }
}
```

### 4.2 核心设计决策

| 决策 | 原因 |
|------|------|
| 参数 schema 用 JSON Schema 子集 | 与 Claude SDK function calling 对齐 |
| `riskLevel`: read / internal_write / external / destructive | 驱动审批门和权限控制 |
| `server` 字段可选 | 无 → CLI 降级模式；有 → 长驻 JSON-RPC 模式 |
| 命名空间自动加 `{app}:` 前缀 | 工具在 Agent 视角为 `med_crm:search_hospitals`，多 APP 不冲突 |

### 4.3 发现与注册

```
happycompany 启动
  → 扫描 corp/*/apps/*/tools.json
  → Zod schema 校验
  → 注册到 ToolRegistry (内存)
  → 生成 {sourceTenant} → [{toolDef}] 映射
  → 有 server.py 的 → AppServerMgr 启动子进程
```

### 4.4 运行时调用路由

```
Agent 决定调用 med_crm:search_hospitals({"keyword": "浙一"})
  → ToolRegistry.lookup("med_crm:search_hospitals")
  → 有 server → JSON-RPC call (stdin/stdout) → 等待结果
  → 无 server → spawn: python -m med_crm.cli search "浙一" --json
  → 返回结构化 JSON
```

### 4.5 CLI 兼容模式

CLI 模式要求每个命令支持 `--json` flag，输出 JSON 而非文本表格。

acme 示例：`python -m med_crm.cli hospitals list --province 浙江 --json`

```json
{"hospitals": [{"id": 1, "name": "浙一医院", "province": "浙江", "city": "杭州"}]}
```

现有 med_crm/cli.py 逻辑不动，只加全局 `--json` flag + JSON 输出分支。

---

## 5. 多租户隔离 (P1)

### 5.1 隔离维度

| 维度 | 机制 |
|------|------|
| 数据 | 每个企业独立 `corp/{name}/data/` 目录 |
| Bot | bot.agentDir 指向 `corp/{name}/`，cwd 绑定企业路径 |
| Session | 已有 `userId:chatId` 隔离 |
| Tool | ToolRegistry 记录来源企业，Agent 只看到所属企业的 tool |
| Web UI | 按当前 bot → 企业 → 展示该企业数据 |

### 5.2 不改的

config.json 格式不变，bot 配置集中管理。企业隔离靠 bot 的 `agentDir` + `cwd` 指向不同 `corp/{name}/`。

### 5.3 acme 迁移

```
corp/acme/
├── app.json                    # 新建
├── roles.json                  # 新建
├── apps/
│   ├── med_crm/
│   │   ├── tools.json          # 新建
│   │   ├── server.py           # 新建（可选，高频场景加速）
│   │   └── ... (现有代码保留)
│   ├── device_procurement/     # 从 corp/acme/device_procurement/ 移入
│   │   ├── tools.json
│   │   └── ...
│   └── device_knowledgebase/   # 从 corp/acme/device_knowledgebase/ 移入
│       └── ...
├── data/
│   ├── crm.db                  # 从 cdata/ 移入
│   ├── knowledge/              # 向量索引
│   └── memory/                 # MemoryManager 文件
└── import/                     # Excel 原始文件 (不变)
```

---

## 6. 权限控制 (P5 — 权限部分)

### 6.1 roles.json

```json
{
  "roles": {
    "admin": {
      "displayName": "管理员",
      "tools": "*"
    },
    "sales": {
      "displayName": "销售",
      "tools": [
        "med_crm:search_*", "med_crm:list_*", "med_crm:get_*",
        "med_crm:add_sales_activity", "med_crm:add_contact",
        "device_kb:search"
      ]
    },
    "maintenance": {
      "displayName": "维修工程师",
      "tools": [
        "med_crm:search_*", "med_crm:list_*", "med_crm:get_*",
        "med_crm:add_incident", "med_crm:update_incident",
        "device_kb:search"
      ]
    },
    "readonly": {
      "displayName": "只读",
      "tools": ["med_crm:search_*", "med_crm:list_*", "med_crm:get_*"]
    }
  },
  "users": {
    "ou_abc123": "sales",
    "ou_def456": "maintenance",
    "ou_admin001": "admin",
    "*": "readonly"
  }
}
```

### 6.2 关键设计

| 决策 | 原因 |
|------|------|
| 角色在企业级定义 | 不同企业角色完全不同 |
| `"tools": "*"` 通配 | admin 全部 tool |
| `"tools": ["med_crm:search_*"]` 前缀通配 | 减少配置量 |
| `"users": {"*": "readonly"}` | 未配置用户默认最低权限 |
| userId 用 IM open_id | 和 session key 同源 |
| 工具按 riskLevel 分类 | read / internal_write / external / destructive |

### 6.3 执行流程

```
Agent 准备调 "med_crm:delete_hospital"
  → AuthGate.check(userId, botName, toolName)
  → 取该 bot 对应企业的 roles.json
  → 查 userId → role → tools 白名单
  → "delete_hospital" 不在 sales 白名单 → ❌ 拒绝
  → Agent 收到: {status: "denied", reason: "此操作需要管理员权限"}

Agent 准备调 "med_crm:search_hospitals"
  → AuthGate.check → riskLevel = "read"
  → read 操作直接放行
  → ToolRegistry 执行

Agent 准备调 "med_crm:delete_hospital" (admin 用户)
  → AuthGate.check → riskLevel = "destructive"
  → 返回 {status: "confirmation_required", message: "确认删除？此操作不可逆"}
  → 用户在 IM 回复 "确认" → 执行
```

---

## 7. Knowledge Engine (P3)

### 7.1 定位

| 层 | 做什么 | 在哪 |
|----|--------|------|
| Knowledge Engine | 向量化、索引、语义检索、多模态 ingestion | `src/knowledge.ts` |
| Knowledge Sources | 哪些文件/URL/目录算知识 | `corp/{name}/knowledge.json` |
| Knowledge Store | 向量索引、文档缓存 | `corp/{name}/data/knowledge/` |

### 7.2 knowledge.json

```json
{
  "sources": [
    {
      "type": "directory",
      "path": "apps/device_knowledgebase/manuals",
      "description": "设备维修手册",
      "extensions": [".pdf", ".html", ".md"]
    },
    {
      "type": "url",
      "url": "https://ggzy.zj.gov.cn/",
      "description": "浙江政府采购公告",
      "crawlDepth": 1
    },
    {
      "type": "memory",
      "source": "conversation",
      "description": "从销售对话中自动沉淀的经验",
      "autoExtract": true
    }
  ]
}
```

### 7.3 检索流程

```
用户问: "GE CT球管过热怎么处理"
  → Agent 调用 knowledge:search("GE CT球管过热")
  → Knowledge Engine 向量检索 → 召回相关文档片段
  → 返回 [{source, score, snippet}]
  → Agent 拿片段组织回复
```

### 7.4 与 MemoryManager 的关系

| 系统 | 管什么 | 检索方式 |
|------|--------|---------|
| MemoryManager | 时间线记忆（"2026-05-06 张三拜访了浙一"） | 关键词 grep + 日期索引 |
| KnowledgeBase | 语义知识（"球管过热→检查冷却系统→更换热交换器"） | 向量语义检索 |

不互相替代，共存。

### 7.5 device_knowledgebase/ 迁移

现有 OpenViking 配置和文档内容直接作为 knowledge source 配置，不再需要独立 OpenViking 部署。

---

## 8. Outcome Loop (P2)

### 8.1 三道反馈信号

| 信号 | 采集方式 | 触发时机 |
|------|---------|---------|
| 即时反馈 | 每次回复后 IM 卡片下方 👍/👎 按钮 | 用户主动点击 |
| 自然对话采集 | 后置分析对话内容，识别成交/解决信号 | 每轮对话结束后自动 |
| Bot 主动回访 | 定时任务发消息回访 | 上次查询后 N 天 |

### 8.2 OutcomeTracker

```sql
CREATE TABLE outcome_log (
  id            TEXT PRIMARY KEY,
  bot_name      TEXT NOT NULL,
  chat_id       TEXT NOT NULL,
  user_id       TEXT,
  session_key   TEXT NOT NULL,
  signal_type   TEXT NOT NULL,  -- 'feedback_button' | 'conversation_nlu' | 'followup_reply'
  feedback      TEXT,           -- positive / negative / none
  deal_ref      TEXT,
  deal_ref_type TEXT,
  confidence    REAL,           -- 自动识别置信度 0-1 (按钮=1.0)
  created_at    INTEGER NOT NULL
);
```

### 8.3 自然对话采集机制

```
销售: "浙一那个 CT 的单子签了，600 万"
  → Agent 正常回复
  → OutcomeTracker 后置异步分析:
    - 识别成交信号 ("签了""中了""落地了")
    - 回溯该 session 在 MessageStore 中的历史
    - 找到之前查过的浙一医院中标/设备记录
    - 自动写 outcome_log: {feedback: "positive", deal_ref: "浙一_CT"}
  → 销售零额外操作
```

信号词列表在企业 `app.json` 中可配置：

```json
{
  "outcomeSignals": {
    "positive": ["签了", "中了", "落地了", "搞定了", "修好了", "正常了"],
    "negative": ["丢了", "没中", "黄了", "放弃了"]
  }
}
```

### 8.4 Bot 主动回访

```json
// app.json
{
  "followup": {
    "enabled": true,
    "delayDays": 3,
    "prompt": "前几天你关注了 {topic}，后来有新消息吗？"
  }
}
```

用户可以不回，不回没数据。不骚扰。

---

## 9. 上下文压缩 (P4)

v1 **不实现**。原因：
- Claude Code SDK 内部已有上下文管理
- MessageStore 全量存储消息，可随时审计回溯
- 自定义 compaction 需要清 SDK session + 摘要注入新 session，成本高
- 先跑一段时间观察 SDK 内置管理效果，再决定

在 `app.json` 中预留配置槽位（v2 使用）：

```json
{
  "contextCompaction": {
    "enabled": false,
    "threshold": 100,
    "keepRecent": 20,
    "summaryPrompt": "..."
  }
}
```

---

## 10. Approval Gate + 预算控制 (P5 — 剩余)

### 10.1 Approval Gate

| Tool 风险等级 | 示例 | 行为 |
|-------------|------|------|
| `read` | search_*, list_*, get_* | 直接执行 |
| `internal_write` | add_contact_note, add_sales_activity | 直接执行，记录日志 |
| `external` | send_message（给客户发消息） | 预览内容 → 用户确认 → 发送 |
| `destructive` | delete_*, switch_staging | 确认 + 理由 |

### 10.2 预算控制

```json
// app.json
{
  "budget": {
    "dailyTokenLimit": 1000000,
    "maxTokensPerQuery": 32000
  }
}
```

| 层 | 机制 |
|----|------|
| 企业级日预算 | Agent 每天累计 token 超限后拒绝，提示"今日额度已用完" |
| 单次上限 | 单次 SDK 调用的 max_tokens 上限 |
| 计数来源 | SDK 返回的 usage 字段累加，存入 MessageStore |

---

## 11. 实施顺序

按依赖关系排列：

```
Phase 1: Tool Manifest (P0)          ← 基础，后续全部依赖
Phase 2: 多租户隔离 (P1)              ← 企业边界先建立
Phase 3: 权限控制 (P5-权限部分)        ← 依赖 P0 tool 注册 + P1 企业边界
Phase 4: Knowledge Engine (P3)       ← 独立模块
Phase 5: Outcome Loop (P2)           ← 依赖 P0 tool 调用链路
Phase 6: Approval Gate + 预算 (P5-剩余) ← 收尾安全项
```

每个 Phase 独立可验证，有自己的验收标准。

---

## 12. acme 验证清单

| 验证项 | 对应 Phase | 验收标准 |
|--------|-----------|---------|
| med_crm 通过 tools.json 接入 | Phase 1 | Agent 可调 `med_crm:search_hospitals` 返回结构化 JSON |
| 企业隔离 | Phase 2 | acme 的数据不会被其他企业 bot 访问 |
| 销售/维修/管理员不同权限 | Phase 3 | sales 角色调 delete_hospital 被拒绝 |
| 维修手册语义检索 | Phase 4 | "CT球管过热"能召回 GE CT 服务手册相关章节 |
| 对话反馈 | Phase 5 | 销售说"浙一的单签了"后被自动记录为 positive |
| 审批门 | Phase 6 | delete_hospital 需要用户确认后才执行 |
