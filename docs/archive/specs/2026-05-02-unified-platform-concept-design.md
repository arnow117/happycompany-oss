# HappyCompany Concept Design

> 2026-05-02
> 状态：概念模型 + 代码复用分析完成，待开发
> 上游：HANDOFF-20260430-projects-fusion.md（四项目融合战略）

---

## 设计意图

将 ohmyappbuilder、bot-swarm、happycompany、med_crm 四个项目合并为一个轻量平台，核心目标：

1. 给管理员提供 builder 式的迭代能力（看使用数据 → AI 出方案 → 审核 → 改 app/skill → 发布）
2. 给用户提供多平台 session 通道（飞书 + 钉钉，群聊/私聊），按 skill 自动路由
3. 用户自带工作目录 + 知识管理，平台往里注入领域 app/CLI/skill
4. 整体轻量，架构简洁，提供独立开发者模式

---

## 核心实体

### 实体定义

| 实体 | 一句话 | 生命周期 |
|------|--------|----------|
| **Channel** | IM 平台适配器（飞书 / 钉钉） | 长期存在，可热插拔 |
| **Topic** | 群聊或私聊通道 | 长期存在，直到被关闭 |
| **Bot** | IM bot 实例，绑定一个 workdir | 长期存在 |
| **Session** | Claude 的执行上下文 | 与 Bot/Workdir 绑定，可 clear |
| **Workdir** | Session 的文件视野 + 用户文件存储 | 与 Bot 1:1，换绑 = session clear |
| **App** | 完整业务小系统（产品说明书 + 开发指导 + model + service + CLI + skill） | 独立于 session，版本化管理 |
| **Skill** | 声明式接口，调用背后 CLI 的能力入口 | 属于某个 App 或通用工具 |
| **CLI** | App 的命令行接口，被 skill 调用 | 属于某个 App |

### 实体关系

```
Channel（飞书/钉钉）──→ Bot ──1:1──→ Workdir ──1:N──→ App
  │                      │                        │
  │                      └──1:1──→ Session        └──1:N──→ Skill
  │                                                 └──1:N──→ CLI
  └──多:1──→ Topic（群聊/私聊）
```

---

## 用户侧模型

### 私聊

用户与特定 Bot 一对一对话。Bot 绑定固定 Workdir，Session 长期存活。

```
用户 ←→ Bot A ←→ Session A ←→ Workdir A
    ↑                        ├── skills/（已安装）
  Channel                   ├── uploads/
（飞书/钉钉）                └── session-data/
```

### 群聊

一个群聊可接入多个 Bot。用户必须 @指定 Bot 才能触发响应。

关键机制：**desc 注入**。每个 Bot 根据其 Workdir 下的 CLAUDE.md 生成能力描述。群聊中，每个 Bot 的 Session 都会被注入所有在线 Bot 的描述。

```
Topic（群聊，飞书/钉钉）
├── Bot A ←→ Session A（注入：A 做什么、B 做什么、C 做什么）
├── Bot B ←→ Session B（注入：A 做什么、B 做什么、C 做什么）
└── Bot C ←→ Session C（注入：A 做什么、B 做什么、C 做什么）

用户 @bot-a "帮我查一下最近的招标"
  → Session A 收到消息
  → Claude 通过 skill 路由到 bid-query CLI
  → 执行 hospital-crm app 的查询逻辑
```

### 调用链

```
用户消息 → Channel → Claude Session → Skill（接口声明）
                                  │
                                  ▼
                                CLI（命令执行）
                                  │
                                  ▼
                              App 代码（业务逻辑）
                                  │
                                  ▼
                            Model / Service / 外部 API
```

Skill 不包含业务逻辑，只声明"我能做什么"和怎么调用背后的 CLI。保证：
- 同一个 skill 可被多个 workdir 复用
- App 代码改了不影响 skill 接口
- 管理员迭代时可以只改 app 代码，不动 skill

---

## 多平台 IM 支持

### 架构：Channel 适配器

```
                 ┌─────────────┐
                 │  Bot Router  │
                 └──────┬───────┘
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
     ┌────────────────┐  ┌────────────────┐
     │ FeishuChannel  │  │ DingTalkChannel│
     └───────┬────────┘  └───────┬────────┘
             │                   │
     ┌───────┴───────┐  ┌───────┴───────┐
     │ feishu-bot.ts │  │ dingtalk.ts   │
     │ (bot-swarm)   │  │ (happycompany rs)│
     └───────────────┘  └───────────────┘
```

两个 Channel 实现同一个 `ChannelAdapter` 接口。Bot Router 不关心消息来自哪个平台。

### ChannelAdapter 接口

```typescript
interface ChannelAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: NormalizedMessage) => void): void
  onCardAction(handler: (action: CardAction) => void): void
  send(target: string, content: MessageContent): Promise<void>
  sendStreaming(target: string): StreamingHandle
  react(messageId: string, emoji: string): Promise<void>
  downloadFile(fileRef: FileRef): Promise<DownloadedFile>
}
```

### 各平台能力矩阵

| 能力 | 飞书 | 钉钉 | 统一抽象 |
|------|------|------|---------|
| 文本消息 | `im.message.create` | `groupMessages/send` | `send(target, text)` |
| 流式卡片 | Card Kit v2（三态） | AI Card（INPUTING → streaming → FINISHED） | `sendStreaming(target)` → `StreamingHandle` |
| 交互按钮 | `card.action.trigger` | 暂不支持 | `onCardAction(handler)` (飞书 only) |
| 文件下载 | 暂未实现 | `messageFiles/download` | `downloadFile(fileRef)` |
| 图片内联 | 暂未实现 | download → base64 (Vision API) | `downloadFile` 返回 `{type: 'image', base64}` |
| Reaction | `im.messageReaction.create` | `/v1.0/robot/emotion/reply` | `react(messageId, emoji)` |
| 自消息过滤 | `sender.open_id !== bot.open_id` | SDK 自动过滤 | Channel 内部处理 |
| 消息去重 | TTL+LRU (30min) | SDK 自动去重 | 统一 dedup 层 |
| 引用消息解析 | 无 | `dingtalk-reply-parser.ts` | `NormalizedMessage.replyTo` |

### 各平台特有优化

**飞书（来自 bot-swarm）**：
- StreamingCard：Card Kit v2，typewriter 效果（50ms/step2），三态 header（blue 流式中 → violet 完成 → orange 中断），工具状态行，中断按钮
- Reaction 确收：每 Bot 独立 emoji（CROWN/HAMMER），快速反馈 + 可观测性
- 防御式错误处理：Feishu API 错误永不崩溃，三级 try-catch，streaming 失败降级为纯文本

**钉钉（来自 happycompany research workspace）**：
- 群聊文件查看：用户发文件/引用文件 → 自动下载 → 文本提取 → nonce fenced block 注入 prompt（含反注入防护）
- 图片下载：小图（<5MB）base64 内联给 Vision API，大图保存路径
- Reply 解析：引用消息中的文件/图片/文本完整解析
- Ack reaction：thinking emoji 收到后附上，streaming card 创建后撤回
- Token 缓存：300s 预过期自动刷新
- 代理兼容：dingtalk-stream SDK 创建时禁用 axios proxy

---

## 管理员侧模型

### 迭代闭环

```
Session Logs（所有 workdir）
    │
    ▼
使用分析层
  ├── 统计：每个 skill/CLI 的调用次数、成功率、用户反馈
  ├── AI 洞察：基于聊天记录分析痛点、建议迭代方向
  └── 输出：迭代建议（改现有 / 新建 / 合并 / 下线）
    │
    ▼
管理员（独立开发界面）
  1. 查看使用统计 + AI 洞察
  2. AI 生成迭代方案（改哪、怎么改）
  3. 管理员审核方案
  4. 执行变更（改 app 代码 / 新建 skill / 调 CLI）
  5. 发布新版本
    │
    ▼
App Registry 更新
    │
    ▼
Workdir 安装新版本（安装流程 + 版本号更新）
    │
    ▼
Session 重载生效（或 session clear 强制重载）
```

### 独立开发界面

独立于用户 session 的开发者界面，提供：
- 查看使用统计和 AI 迭代建议
- 编辑 App 代码（model / service / CLI）
- 编辑 Skill 定义
- 版本管理（发布 / 回滚）
- 知识库管理

---

## 目录结构

### System Dir（管理员域）

平台级目录，管理员在这里开发和管理 App。与用户 workdir 完全隔离。

```
/system/
├── registry.json              # 全局 app/skill 注册表 + 版本号
├── apps/
│   ├── hospital-crm/
│   │   ├── v1.0/              # 版本化管理
│   │   │   ├── README.md      # 产品说明书（给用户看）
│   │   │   ├── CLAUDE.md      # 开发指导（给 AI 看，引用 README）
│   │   │   ├── skills/
│   │   │   ├── cli/
│   │   │   ├── models/
│   │   │   └── services/
│   │   └── v1.1/
│   │       └── ...
│   ├── bid-crawler/
│   │   └── v1.0/
│   └── knowledge-base/
│       └── v1.0/
└── skills/                    # 通用 skill 定义（全局复用）
    ├── kb-query.skill
    ├── kb-ingest.skill
    ├── bid-query.skill
    ├── maintenance-remind.skill
    └── crawl-trigger.skill
```

### Workdir（用户 Session 域）

每个 Bot 绑定的用户工作目录，Session 的文件视野。

```
/workdir-{bot-id}/
├── installed.json             # 已安装 app/skill + 版本号
├── CLAUDE.md                  # 生成 Bot 能力描述（群聊 desc 注入来源）
├── .claude/
│   └── skills/                # 已安装的 skill（指向 system）
├── uploads/                   # 用户上传的文件
└── session-data/              # session 上下文持久化
```

### 安装与版本管理

```
管理员在 System Dir 改 app 代码
    │
    ▼
发布新版本（v1.0 → v1.1），registry.json 更新
    │
    ▼
Workdir 执行 install/update，installed.json 版本号变更
    │
    ▼
下次 session 启动时加载新版本
（或管理员触发 session clear 强制重载）
```

---

## 核心设计决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | Session 模型 | 单 Session + skill 自动路由 | 轻量，Claude 原生能力 |
| 2 | Bot ↔ Workdir | 1:1，换绑 = 清 session | 保持 context 一致性 |
| 3 | App 分发 | 全局 Registry，按 workdir 按需安装 | 统一管理 + 版本控制 |
| 4 | 调用链 | skill → CLI → app 代码 | skill 不含业务逻辑，可复用 |
| 5 | 群聊路由 | 必须 @指定 Bot | 明确意图，避免误触发 |
| 6 | Bot 描述来源 | workdir 下 CLAUDE.md 自动生成 | 声明式，跟着代码走 |
| 7 | 迭代闭环 | AI 出方案 + 人审核 | 效率 + 控制权 |
| 8 | 知识管理 | 作为独立 App（kb-query + kb-ingest） | 统一架构，复用 skill 机制 |
| 9 | System Dir 与 Workdir | 完全隔离，通过安装流程连接 | 安全 + 版本控制 |
| 10 | 变更生效 | 安装后下次 session 启动生效 | 可预测，可回滚 |
| 11 | App 定义 | README.md + CLAUDE.md + 代码，三者同等重要 | 产品说明书是选 App 核心依据，开发指导保证一致性 |
| 12 | IM 平台 | 飞书 + 钉钉，Channel 适配器模式 | 覆盖两个主要企业 IM，适配器解耦 |
| 13 | 骨架代码 | 以 bot-swarm 为基础，选择性吸收 happycompany 功能 | bot-swarm 代码质量好、模块化清晰 |
| 14 | 语言策略 | 双语言：TypeScript（平台）+ Python（App CLI/代码） | 各取所长，通过 CLI 接口通信 |
| 15 | 流式卡片 | 各平台独立实现，统一 StreamingHandle 接口 | 飞书 Card Kit v2 和钉钉 AI Card API 差异大，硬统一反而复杂 |

---

## App 的三层结构

App 不只是代码，它是**产品说明书 + 开发指导 + 技术实现**三位一体，且需要一致性校验。

### 三层定义

| 层 | 文件 | 给谁看 | 内容 |
|---|------|--------|------|
| **产品层** | README.md | 人（管理员/用户） | 解决什么问题、工作流图解、操作指南 |
| **开发层** | CLAUDE.md | AI（Claude） | 引用 README + 技术方案 + 验证方法 + 迭代规则 |
| **实现层** | skills/ + cli/ + models/ + services/ | 运行时 | 代码 |

### 一致性保障

README.md 里声明的工作流步骤，每一步必须有对应的 skill/CLI 实现支撑。CLAUDE.md 引用 README 作为产品真相源，改了产品说明，开发侧自动感知变更。

### Skill 定义格式（SKILL.md frontmatter）

采用 happycompany 已有的 SKILL.md frontmatter 格式：

```yaml
---
id: bid-query
name: 招标信息查询
description: 查询各省中标数据，支持按关键字、省份、时间范围筛选
allowed-tools: [Bash, Read, Write]
user-invocable: true
---
```

### App 目录结构

```
apps/hospital-crm/
├── v1.0/
│   ├── README.md              ← 产品说明书（一等公民）
│   ├── CLAUDE.md              ← 开发指导（一等公民）
│   ├── skills/
│   │     ├── bid-query.skill
│   │     └── maintenance-remind.skill
│   ├── cli/
│   │     └── hospital-search
│   ├── models/
│   └── services/
```

---

## 代码复用映射

### 项目归宿

| 项目 | 处置 | 理由 |
|------|------|------|
| **bot-swarm** | **主力代码源** — 平台骨架 | 代码质量最好，模块化清晰，飞书 + Session + 后台基础设施完备 |
| **happycompany** | **功能采石场** — 选择性吸收 | 功能全但单体巨石，取其好的设计（IM 抽象、SKILL.md 格式、配置加密、任务调度） |
| **ohmyappbuilder** | **概念参考** — 少量工具函数 | Wish→Build 流水线与"管理员手动迭代"模式不符 |
| **med_crm** | **直接成为 hospital-crm v1.0** | 已是完整 App，直接搬入 System Dir |

### 直接复用（不改动）

| 代码 | 来源 | 用途 |
|------|------|------|
| `feishu-bot.ts` | bot-swarm | 飞书 Bot WebSocket 连接 + 消息解析 |
| `agent.ts` | bot-swarm | Claude Session 管理 + per-chat 持久化 |
| `streaming-card.ts` | bot-swarm | 飞书流式卡片（Card Kit v2） |
| `dedup.ts` | bot-swarm | 消息去重（TTL+LRU） |
| `message-bus.ts` | bot-swarm | 事件总线 |
| `message-store.ts` | bot-swarm | SQLite 消息持久化 |
| `im-channel.ts` | happycompany | IM 通道统一接口抽象 |
| `skill-utils.ts` | happycompany | Skill 发现 + SKILL.md frontmatter 解析 |
| `task-scheduler.ts` | happycompany | Cron/interval/once 任务调度 |
| `runtime-config.ts` (AES 部分) | happycompany | 加密配置存储 |
| `_sanitize_payload` | ohmyappbuilder | LLM 输出清洗 |
| med_crm 全套 | corp/acme | hospital-crm v1.0 |

### 提取改造

| 代码 | 来源 | 改造内容 |
|------|------|---------|
| `swarm.ts` 路由逻辑 | bot-swarm | 去掉拓扑 fan-out，改为 1:1 Bot↔Workdir + 群聊 desc 注入 |
| `types.ts` | bot-swarm | 抽象 NormalizedMessage，去掉 Feishu 字段 |
| `config.ts` | bot-swarm | 分离 Feishu 账号配置，加 Channel 适配器配置 |
| `web.ts` + React UI | bot-swarm | 从 Bot 管理改为 App 管理 + 版本发布 + 使用分析 |
| `dingtalk.ts` | happycompany rs | 提取为 DingTalkChannel，实现 ChannelAdapter |
| `dingtalk-streaming-card.ts` | happycompany rs | 提取为钉钉流式卡片，实现 StreamingHandle |

### 新建

| 模块 | 说明 |
|------|------|
| `channel-adapter.ts` | ChannelAdapter 接口 + Bot Router |
| `registry.ts` | App registry + 版本管理 + 安装流程 |
| `desc-injector.ts` | 群聊 desc 注入（从 workdir CLAUDE.md 生成 Bot 能力描述） |
| `consistency-check.ts` | README.md 工作流 ↔ skill/CLI 实现对齐检查 |
| `usage-analytics.ts` | 基于 message-store 的统计 + LLM 洞察分析 |
| `app-scaffolder.ts` | App 三层结构脚手架（README + CLAUDE.md + 代码骨架） |

### 废弃

| 代码 | 来源 | 理由 |
|------|------|------|
| wish→build 流水线 | ohmyappbuilder | 管理员手动迭代取代自动构建 |
| 代码生成器 | ohmyappbuilder | 不再自动生成 App |
| Web 模板 | ohmyappbuilder | 被 React SPA 取代 |
| 拓扑 DAG | bot-swarm | 统一平台是 1:1 模型 |
| Docker 容器执行 | happycompany | 暂不需要容器隔离，进程内 Session 足够 |

---

## 已知的领域 App 实例

| App | 内容 | Skill | CLI |
|-----|------|-------|-----|
| 医院售前售后 | 医院 CRM（models + services） | bid-query, maintenance-remind | hospital-search |
| 竞品爬虫 | 中标信息抓取 | crawl-trigger | bid-crawler |
| 知识管理 | 知识库查询与写入 | kb-query, kb-ingest | — |

来源：acme（杭州示例医疗器械）作为 v0 样本。

---

## 技术选型

| 层 | 技术 | 理由 |
|---|------|------|
| 平台（IM + Session + 后台） | TypeScript / Hono / React 19 / Vite | bot-swarm 已验证 |
| IM SDK | `@larksuiteoapi/node-sdk` + `dingtalk-stream` | 各自官方 SDK |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` | bot-swarm 已验证 |
| 数据库 | better-sqlite3 (WAL) | 轻量，无需外部依赖 |
| App CLI / 代码 | Python / SQLAlchemy / Click | med_crm 已验证 |
| 配置验证 | Zod | bot-swarm 已验证 |
