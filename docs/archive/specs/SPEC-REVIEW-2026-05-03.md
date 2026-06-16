# Spec 一致性深度校验

> 2026-05-03
> 对照文件：specs/2026-05-02-happycompany-concept-design.md
> 审计范围：全部 429 行 spec，逐节对照 src/ + web/ + apps/
> 上游审计：AUDIT-2026-05-03.md（约束/决策/测试维度的补充）

---

## 总览

| 状态 | 数量 | 占比 |
|------|------|------|
| IMPLEMENTED | 16 | 53% |
| PARTIAL | 9 | 30% |
| MISSING | 4 | 13% |
| SPEC ISSUE | 1 | 4% |
| **合计** | **30** | 100% |

---

## 详细发现

### 1. 架构总览 — Channel/Bot/Agent/Registry/Workdir 分层

- **Status**: IMPLEMENTED
- **Spec says**: 五层架构 — Channel(适配器) -> Bot(路由) -> Agent(Claude Session) -> Registry(App 版本) -> Workdir(文件视野)
- **Code has**:
  - `src/channel.ts` — ChannelAdapter 接口定义
  - `src/bot.ts` — BotManager，1:1 Bot-to-Channel 路由，群聊 @mention 检测
  - `src/agent.ts` — ClaudeAgent，per-bot session 管理，per-chat 持久化
  - `src/registry.ts` — App 发布/回滚/安装，版本管理
  - `src/workdir.ts` — installed.json 管理，install/remove/update 操作
  - `src/index.ts` — main() 串联所有层
- **Gap**: 无
- **Recommendation**: 无需变更

---

### 2. 核心实体定义

- **Status**: IMPLEMENTED
- **Spec says**: 8 个实体 — Channel, Topic, Bot, Session, Workdir, App, Skill, CLI
- **Code has**:
  - Channel → `ChannelAdapter` 接口
  - Topic → 未显式建模，但群聊 chatId 作为 topic 标识（在 NormalizedMessage.chatId 中体现）
  - Bot → `BotConfig` + `BotManager`
  - Session → `ClaudeAgent` 内部 sessionIds Map + 持久化 `.session-*.json`
  - Workdir → `WorkdirInfo` + installed.json
  - App → `AppInfo` in registry.ts
  - Skill → `SkillInfo` in skills.ts
  - CLI → `app-runner.ts` (runAppCli, hasCliEntry, listCliApps)
- **Gap**: Topic 未作为独立类型建模。群聊/私聊通过 chatId 前缀区分（`isGroupChat()`），但无 `Topic` 实体。
- **Recommendation**: 低优先级。当前 chatId 区分方式功能上完整，Topic 实体在单群场景下无额外价值。如果将来需要管理群聊列表（如列出 Bot 加入的所有群），可以引入 Topic 模型。

---

### 3. App 三层结构 (README.md + CLAUDE.md + 代码)

- **Status**: IMPLEMENTED
- **Spec says**: App 是产品说明书(README) + 开发指导(CLAUDE.md) + 实现代码三位一体，需要一致性校验
- **Code has**:
  - `src/consistency-check.ts` — `checkAppConsistency()` 校验 README ↔ SKILL.md ↔ CLAUDE.md 对齐
  - Web API 端点 `/api/admin/apps/:name/consistency`
  - 三个示例 App 全部包含三层文件:
    - `apps/kb-management/v1.0/` — README.md + CLAUDE.md + SKILL.md + bin/ingest + bin/query
    - `apps/python-example/v1.0/` — README.md + CLAUDE.md + SKILL.md + bin/run + src/hello.py
    - `apps/test-app/v1.0/` — SKILL.md + bin/run
- **Gap**: test-app 缺少 README.md 和 CLAUDE.md，只有 SKILL.md（作为测试 fixture 可接受）。一致性检查不验证 README 中声明的工作流步骤是否有对应的 CLI/skill 实现支撑（spec 说 "README.md 里声明的工作流步骤，每一步必须有对应的 skill/CLI 实现支撑"）。
- **Recommendation**:
  1. test-app 添加 README.md + CLAUDE.md（或标记为测试专用，不做一致性校验）
  2. 考虑在 consistency-check 中增加"README 工作流步骤 → CLI/skill 映射"的验证（中级优先级）

---

### 4. Skill 系统

- **Status**: PARTIAL
- **Spec says**: SKILL.md frontmatter 格式，skill 发现，用户 @bot 触发 → skill 自动路由
- **Code has**:
  - `src/skills.ts` — frontmatter 解析（parseFrontmatter），skill 目录扫描（scanSkillDirectory），ID 验证（validateSkillId），路径安全校验（validateSkillPath）
  - Web API — skill CRUD 端点
  - `desc.ts` — 生成 capability 描述，注入到 prompt 前缀
- **Gap**:
  1. **Spec 说 "Skill 不包含业务逻辑，只声明'我能做什么'和怎么调用背后的 CLI"** — 当前 SKILL.md 内含详细文档（如 kb-management 的 SKILL.md 有 186 行文档），超出"声明式接口"范畴。这不是 bug，但与 spec 的"skill 只声明接口"描述有偏差
  2. **Skill 自动路由** — spec 描述用户消息通过 skill 路由到 CLI，但代码中 skill 路由完全依赖 Claude 的 native skill 理解能力（通过 desc 注入 + workdir .claude/skills/ 目录结构），没有显式的路由/匹配逻辑。这是设计选择（spec D1："单 Session + skill 自动路由"），与 spec 一致
- **Recommendation**: SKILL.md 内容偏重在 kb-management 场景下合理（Claude 需要详细指导来正确执行 ingest/query），但 spec 中"skill 只声明接口"的描述可以放宽为"skill 声明接口 + 提供使用指导"

---

### 5. ChannelAdapter 接口

- **Status**: IMPLEMENTED
- **Spec says**: 统一接口 — start/stop/onMessage/onCardAction/send/sendStreaming/react/downloadFile
- **Code has**: `src/channel.ts` 定义完全匹配的 `ChannelAdapter` 接口，包括 `StreamingHandle`、`CardAction`、`DownloadedFile` 类型
- **Gap**: 无
- **Recommendation**: 无需变更

---

### 6. 飞书 Channel (FeishuChannel)

- **Status**: IMPLEMENTED
- **Spec says**:
  - 文本消息 (`im.message.create`)
  - 流式卡片 (Card Kit v2, 三态 header, typewriter, 中断按钮)
  - 交互按钮 (`card.action.trigger`)
  - 文件下载 (`messageResource`)
  - 图片内联 (base64 for Vision API)
  - Reaction 确收
  - 自消息过滤
- **Code has**:
  - `src/feishu.ts` — 完整实现所有 spec 要求的能力
  - `src/streaming-card.ts` — Card Kit v2, 三态 header (blue/violet/orange), typewriter 50ms/step2, 工具状态行, 中断按钮
  - Reaction: `im.messageReaction.create`
  - 自消息过滤: `senderOpenId === this.botOpenId` check
  - 文件/图片下载: `messageResource.get` + text extraction + base64 for images
  - Card action: `card.action.trigger` handler
- **Gap**: 无。完全匹配 spec。
- **Recommendation**: 无需变更

---

### 7. 钉钉 Channel (DingTalkChannel)

- **Status**: IMPLEMENTED
- **Spec says**:
  - 文本消息 (`groupMessages/send`)
  - 流式卡片 (AI Card, INPUTING → streaming → FINISHED)
  - 文件下载 (`messageFiles/download`)
  - 图片下载 (base64 for Vision API)
  - Reaction (thinking emoji ack)
  - 代理兼容 (disable axios proxy)
  - Token 缓存 (300s pre-expire)
  - Reply 解析 (dingtalk-reply-parser)
  - Ack reaction (thinking → 撤回)
- **Code has**:
  - `src/dingtalk.ts` — 完整实现所有 spec 要求的能力
  - `src/dingtalk-card.ts` — AI Card 完整生命周期 (create → deliver → INPUTING → streaming → FINISHED/FAILED), 500ms 节流
  - `src/dingtalk-reply-parser.ts` — Reply 引用消息解析
  - `src/dingtalk-utils.ts` — 文件文本提取, downloadByCode
  - Token 缓存: 300s pre-expire
  - 代理兼容: axios.defaults.proxy = false
  - Reaction: thinking emoji attach
  - C2C + Group 双支持
- **Gap**: 无。完全匹配 spec。
- **Recommendation**: 无需变更

---

### 8. 统一去重层

- **Status**: IMPLEMENTED
- **Spec says**: 飞书 TTL+LRU (30min)，钉钉 SDK 自动去重，统一 dedup 层
- **Code has**: `src/dedup.ts` — TTL+LRU 去重，默认 1000 entries, 30min TTL。在 `bot.ts` 中使用。DingTalkChannel 也有内部 dedup 实例。
- **Gap**: 无
- **Recommendation**: 无需变更

---

### 9. 群聊 desc 注入

- **Status**: PARTIAL
- **Spec says**: 每个Bot根据Workdir下CLAUDE.md生成能力描述。群聊中每个Bot的Session都会被注入所有在线Bot的描述。
- **Code has**:
  - `src/desc.ts` — `extractBotDescription()` 从 workdir CLAUDE.md 提取 bot 级描述，`generateCapabilityDesc()` 从已安装 app 的 SKILL.md 生成能力列表
  - `src/index.ts` — `buildCapabilityDesc()` 在启动时遍历所有 bot，生成描述块，注入到所有 prompt 前缀
- **Gap**:
  1. 描述是启动时一次性生成并缓存的，不是每次消息实时刷新。如果管理员安装新 app 后不重启服务，desc 不会更新
  2. 没有检测群聊 vs 私聊，desc 对所有消息都注入（私聊不需要知道其他 bot 的能力）
- **Recommendation**:
  1. 中优先级：在 install handler 中触发 desc 刷新（或改为惰性生成，每次消息时检查 workdir 变化）
  2. 低优先级：私聊消息跳过其他 bot 的 desc 注入

---

### 10. 群聊 @路由

- **Status**: IMPLEMENTED
- **Spec says**: 群聊必须 @指定 Bot 才触发响应
- **Code has**: `bot.ts` `shouldRespond()` — 私聊 always respond，群聊检查 `@displayName` 或 `@name`
- **Gap**: 无功能缺口，但未验证 `@` 前后的格式兼容性（如全角 @、有空格等）
- **Recommendation**: 低优先级，可在 E2E 测试中覆盖

---

### 11. Registry + 发布/安装/回滚

- **Status**: IMPLEMENTED
- **Spec says**:
  - `registry.json` 全局 App/Skill 注册表 + 版本号
  - 发布新版本（v1.0 → v1.1）
  - 回滚到指定版本
  - 安装到 workdir（installed.json 更新）
  - 安装后下次 session 启动生效
- **Code has**:
  - `src/registry.ts` — `publish()`, `rollback()`, `installApp()`, `getAppSourceDir()`, `listApps()`
  - `src/workdir.ts` — `installAppToWorkdir()`, `updateAppVersion()`, `removeAppFromWorkdir()`
  - Web API — `/api/admin/apps/publish`, `/api/admin/apps/rollback`, `/api/admin/apps/install`
  - 安装后清 session：`botManager.clearSessionsForWorkdir()`
- **Gap**: 无
- **Recommendation**: 无需变更

---

### 12. 版本化 App 目录结构

- **Status**: PARTIAL
- **Spec says**:
  ```
  /system/
  ├── registry.json
  ├── apps/
  │   ├── hospital-crm/
  │   │   ├── v1.0/
  │   │   │   ├── README.md
  │   │   │   ├── CLAUDE.md
  │   │   │   ├── skills/
  │   │   │   ├── cli/
  │   │   │   ├── models/
  │   │   │   └── services/
  ```
- **Code has**:
  - `apps/kb-management/v1.0/` — README.md + CLAUDE.md + SKILL.md + bin/
  - `apps/python-example/v1.0/` — README.md + CLAUDE.md + SKILL.md + bin/ + src/
  - `apps/test-app/v1.0/` — SKILL.md + bin/
- **Gap**:
  1. **缺 hospital-crm App** — spec 明确提到"med_crm 全套直接成为 hospital-crm v1.0"，但代码中不存在此 App。只有 kb-management、python-example、test-app
  2. **缺 bid-crawler App** — spec 提到的竞品爬虫 App 不存在
  3. **缺全局 skills/ 目录** — spec 描述 `/system/skills/` 存放全局复用的 skill 定义，当前代码使用 `{dataDir}/skills/` 但只有空的 data/skills/ 目录，没有实际的通用 skill 文件
  4. **Skill 文件位置** — spec 说 App 下有 `skills/` 子目录存放 skill 文件，当前实现是 App 根目录直接放 SKILL.md（不是 skills/ 子目录）
- **Recommendation**:
  1. hospital-crm 是业务 App，需要从 med_crm 迁移，优先级取决于 v0 客户（示例医疗）的需求
  2. 全局 skills/ 目录是设计预留，当前所有 skill 都是 App 内嵌的，等有跨 App 复用的 skill 时再填充
  3. SKILL.md 位置约定（App 根目录 vs skills/ 子目录）需要统一

---

### 13. Workdir 目录结构

- **Status**: IMPLEMENTED
- **Spec says**:
  ```
  /workdir-{bot-id}/
  ├── installed.json
  ├── CLAUDE.md
  ├── .claude/skills/
  ├── uploads/
  └── session-data/
  ```
- **Code has**:
  - `src/workdir.ts` — `initWorkdir()` 创建 `.claude/skills/` + `uploads/` + `installed.json`
  - CLAUDE.md 由 workdir 所有者手动维护（用于 bot 描述注入）
- **Gap**:
  1. `session-data/` 目录未自动创建 — spec 说这是 "session 上下文持久化" 目录，但 session 持久化实际在 `agentDir/.session-*.json` 中，session-data 目录未被使用
  2. Workdir 命名不强制 `workdir-{bot-id}` 格式 — 通过 config.json 中的 cwd/agentDir 指定
- **Recommendation**:
  1. session-data/ 可以移除或改为 session data 的约定目录（低优先级）
  2. 命名约定是 spec 建议，不是强制要求

---

### 14. 管理员侧 — 独立开发界面 (Admin Web UI)

- **Status**: PARTIAL
- **Spec says**:
  - 查看使用统计和 AI 迭代建议
  - 编辑 App 代码 (model/service/CLI)
  - 编辑 Skill 定义
  - 版本管理（发布/回滚）
  - 知识库管理
- **Code has**:
  - `web/src/pages/Dashboard.tsx` — 系统概览（已连接 bots、活跃 chats、消息总数）
  - `web/src/pages/Apps.tsx` — App 列表 + 发布表单 + 回滚 + 版本历史 + README 查看器 + 文件浏览器
  - `web/src/pages/Skills.tsx` — Skill 列表（扫描 data/skills/ 目录）
  - `web/src/pages/Stats.tsx` — 消息统计（per-chat 消息数）
  - `web/src/pages/Insights.tsx` — AI 洞察（生成 + 查看 + approve/reject/mark executed）
  - `web/src/pages/KnowledgeBase.tsx` — 占位页 ("Coming Soon")
  - Skill 编辑: Web API PUT `/api/admin/workdir/:path/skills/:name` 可编辑 SKILL.md 内容
  - App 文件浏览: `/api/admin/apps/:name/files/*` 可查看/读取源文件
- **Gap**:
  1. **不能在线编辑 App 代码** — 只能浏览文件，不能修改 model/service/CLI 代码。只支持 SKILL.md 编辑
  2. **KnowledgeBase 页面是占位符** — "Coming Soon"，实际上 kb-management 作为 App 已实现，只是没有独立的 KB 管理页面
  3. **缺 AI 迭代方案生成** — Insights 只能 "improve/create/merge/retire" 建议，不能生成具体的代码变更方案（spec 说 "AI 生成迭代方案（改哪、怎么改）"）
  4. **缺版本对比/diff** — 无法查看两个版本之间的差异
- **Recommendation**:
  1. 在线代码编辑是核心功能，需要添加文件编辑能力（PUT 端点 + 编辑器 UI）
  2. KnowledgeBase 页面可以直接复用 Apps 页面的模式（kb-management 就是一个 App）
  3. AI 迭代方案生成需要增强 insights 的 detail 级别（当前只有简短描述）

---

### 15. 使用分析层

- **Status**: PARTIAL
- **Spec says**:
  - 统计：每个 skill/CLI 的调用次数、成功率、用户反馈
  - AI 洞察：基于聊天记录分析痛点、建议迭代方向
  - 输出：迭代建议（改现有/新建/合并/下线）
- **Code has**:
  - `src/analytics.ts` — 每日消息统计（per-chat, per-day），upsert 到 analytics.db
  - `src/insights.ts` — AI 洞察生成（调 Claude API），存储到 ai_insights 表，CRUD 状态管理
  - Web API — `/api/admin/analytics/usage`, `/api/admin/analytics/chats/:chatId`
  - Web UI — Stats 页面（消息统计）+ Insights 页面（AI 洞察）
- **Gap**:
  1. **缺 per-skill/per-CLI 统计** — spec 要求"每个 skill/CLI 的调用次数、成功率"，当前只有 per-chat 消息数
  2. **缺成功率统计** — 无错误/成功分类
  3. **缺用户反馈收集** — 无反馈机制（满意/不满意按钮等）
  4. **AI 洞察模型硬编码** — `claude-sonnet-4-20250514` 硬编码在 insights.ts 中，应跟随 config 中的 model 配置
- **Recommendation**:
  1. 高优先级：添加 per-skill 调用追踪（需要在 agent 回复中识别 tool_use → CLI 调用链）
  2. 中优先级：添加用户反馈机制（如 reaction 按钮映射到满意度）
  3. 低优先级：AI 洞察模型配置化

---

### 16. 迭代闭环

- **Status**: PARTIAL
- **Spec says**: Session Logs → 使用分析层 → AI 洞察 → 管理员审核 → 执行变更 → App Registry 更新 → Workdir 安装 → Session 重载生效
- **Code has**:
  - Session Logs → MessageStore（SQLite 持久化）
  - 使用分析层 → analytics.ts + insights.ts
  - AI 洞察 → insights.ts（生成 + 状态管理）
  - 管理员审核 → Insights UI（approve/reject/mark executed）
  - 执行变更 → App publish + 版本管理 + skill 编辑
  - App Registry 更新 → registry.ts
  - Workdir 安装 → install handler + session clear
  - Session 重载 → clearSessionsForWorkdir
- **Gap**:
  1. **闭环的 "执行变更" 步骤是手动的** — 管理员需要手动改代码、publish、install。spec 明确说这是 "AI 出方案 + 人审核" 的手动模式，所以这是符合设计的
  2. **缺 "基于 AI 洞察自动建议变更"** — Insights 只给出方向性建议，不能自动关联到具体 App/skill 的变更
  3. **迭代效果验证** — 执行变更后无法对比迭代前后的使用数据变化
- **Recommendation**:
  1. 低优先级：Insight 增加关联 App/skill 字段，便于追踪
  2. 低优先级：Insight 增加 "iteration" 标记，记录哪些 insight 被执行了以及效果如何

---

### 17. Skill 定义格式 (SKILL.md frontmatter)

- **Status**: IMPLEMENTED
- **Spec says**:
  ```yaml
  ---
  id: bid-query
  name: 招标信息查询
  description: ...
  allowed-tools: [Bash, Read, Write]
  user-invocable: true
  ---
  ```
- **Code has**: `src/skills.ts` `parseFrontmatter()` 支持 `>`, `|` 多行值。实际使用的字段包括：name, description, user-invocable, allowed-tools, argument-hint
- **Gap**: Spec 中有 `id` 字段，实际实现中 `id` 来自目录名（`entry.name`），不是 frontmatter 字段。这比 spec 更好（避免 id 与目录名不一致）
- **Recommendation**: 更新 spec 文档，说明 `id` 由目录名决定，不需要在 frontmatter 中声明

---

### 18. 技术选型

- **Status**: IMPLEMENTED
- **Spec says**: TypeScript + Hono + React 19 + Vite, @larksuiteoapi/node-sdk + dingtalk-stream, @anthropic-ai/claude-agent-sdk, better-sqlite3 (WAL), Python/SQLAlchemy/Click for App CLI, Zod
- **Code has**:
  - TypeScript + Hono: `src/web.ts` 使用 Hono
  - React: `web/` 使用 React + react-router-dom + Vite
  - @larksuiteoapi/node-sdk: `src/feishu.ts`
  - dingtalk-stream: `src/dingtalk-stream-stub.ts`（stub，实际 DingTalk 使用原生 WebSocket）
  - @anthropic-ai/claude-agent-sdk: `src/agent.ts`
  - better-sqlite3 (WAL): `src/store.ts`, `src/analytics.ts`
  - Zod: `src/schemas.ts`, `src/config.ts`
  - Python App: `apps/python-example/` (requirements.txt + src/hello.py)
- **Gap**: SQLAlchemy 未在 Python App 示例中使用（用纯 Python），Click 未使用（用 argparse/手动解析）。这不违反 spec（spec 说 "Python/SQLAlchemy/Click" 是 App 选项），但 sample 不够完整
- **Recommendation**: 低优先级。Python App 示例当前是 minimal example，不需要完整的 SQLAlchemy/Click

---

### 19. 配置管理

- **Status**: IMPLEMENTED
- **Spec says**: Zod 配置验证, $ENV_VAR 环境变量展开
- **Code has**:
  - `src/config.ts` — Zod schema + `$ENV_VAR` 展开 + loadConfig()
  - `config.example.json` — 示例配置，所有敏感值用 $ENV_VAR
- **Gap**: 无
- **Recommendation**: 无需变更

---

### 20. 消息存储

- **Status**: IMPLEMENTED
- **Spec says**: SQLite 消息持久化 (message-store.ts from bot-swarm)
- **Code has**: `src/store.ts` — MessageStore, better-sqlite3 WAL, insert/listChats/listMessages/clearAll
- **Gap**: 无
- **Recommendation**: 无需变更

---

### 21. 事件总线

- **Status**: PARTIAL
- **Spec says**: 事件总线 (message-bus.ts from bot-swarm)
- **Code has**: `src/bus.ts` — MessageBus, in-process pub/sub + rolling buffer (200 events)
- **Gap**: spec 说 "Web UI live feed over WebSocket"，但当前 Web UI 没有使用 WebSocket 连接 MessageBus。Bus 的 snapshot() 方法存在但未被调用。
- **Recommendation**: 中优先级。添加 WebSocket 端点让 Web UI 实时显示消息流（live feed）。当前是静态数据加载（页面刷新获取最新数据）。

---

### 22. 防御式错误处理

- **Status**: IMPLEMENTED
- **Spec says**: 飞书 API 错误永不崩溃，三级 try-catch，streaming 失败降级为纯文本
- **Code has**:
  - `bot.ts` — handleMessage 外层 try/catch，错误降级为"处理消息时出现错误"
  - `feishu.ts` — handleMessageEvent 外层 try/catch，Reaction 错误降级为 debug log
  - `streaming-card.ts` — 所有 API 调用 try/catch，非致命错误降级
  - `dingtalk-card.ts` — 完整的错误处理 + fallbackSend 降级
- **Gap**: 无
- **Recommendation**: 无需变更

---

### 23. 一致性校验 (README ↔ skill/CLI 实现对齐)

- **Status**: PARTIAL
- **Spec says**: "README.md 里声明的工作流步骤，每一步必须有对应的 skill/CLI 实现支撑"
- **Code has**: `src/consistency-check.ts` 校验:
  - SKILL.md 存在性和 frontmatter 完整性
  - README.md 存在性和标题匹配
  - CLAUDE.md 存在性
  - bin/run 可执行性
  - Python requirements.txt
- **Gap**: 不验证 README 中声明的工作流步骤是否有对应的 CLI 实现。例如 README 说 "执行 hospital-search"，但没有检查 `bin/hospital-search` 是否存在
- **Recommendation**: 中优先级。可以添加基于正则的 "README CLI 引用 → bin/ 目录匹配" 检查

---

### 24. App 脚手架 (app-scaffolder)

- **Status**: MISSING
- **Spec says**: 新建 `app-scaffolder.ts` — App 三层结构脚手架（README + CLAUDE.md + 代码骨架）
- **Code has**: 无 app-scaffolder 模块
- **Gap**: 创建新 App 需要手动建立目录结构
- **Recommendation**: 中优先级。添加 `scaffold-app` CLI 命令或 Web UI 操作，自动生成 App 三层结构骨架

---

### 25. 配置加密存储 (AES)

- **Status**: MISSING
- **Spec says**: 提取自 happycompany 的 `runtime-config.ts` (AES 部分) — 加密配置存储
- **Code has**: 无加密配置功能。config.json 使用 $ENV_VAR 引用，但敏感值（如 API key）在展开后以明文存在于内存中
- **Gap**: 无 AES 加密配置存储
- **Recommendation**: 低优先级。当前 $ENV_VAR 方案对服务器部署足够（环境变量本身就受系统保护）。AES 加密主要在桌面/本地部署场景有价值。

---

### 26. 任务调度器 (task-scheduler)

- **Status**: MISSING
- **Spec says**: 提取自 happycompany 的 `task-scheduler.ts` — Cron/interval/once 任务调度
- **Code has**: 无任务调度模块
- **Gap**: 无定时任务能力（如定时爬取、定时报告等）
- **Recommendation**: 低优先级。可以在需要时从 happycompany 提取。当前没有已知的定时任务需求。

---

### 27. 领域 App 实例 — hospital-crm

- **Status**: MISSING
- **Spec says**: 医院售前售后 App（bid-query, maintenance-remind, hospital-search），作为 v0 样本
- **Code has**: 不存在 hospital-crm App。只有 kb-management、python-example、test-app
- **Gap**: 这是 spec 中最核心的领域 App（"杭州示例医疗器械 v0 样本"），完全缺失
- **Recommendation**: 高优先级。如果这个项目要面向真实客户使用，需要将 med_crm 迁移为 hospital-crm App（包含 models/, services/, cli/, skills/）

---

### 28. 领域 App 实例 — bid-crawler

- **Status**: MISSING
- **Spec says**: 竞品爬虫 App（crawl-trigger skill + bid-crawler CLI）
- **Code has**: 不存在 bid-crawler App
- **Gap**: 缺爬虫 App
- **Recommendation**: 中优先级。取决于 v0 客户需求

---

### 29. Bot 描述 vs App 描述分离

- **Status**: SPEC ISSUE
- **Spec says**: "Bot 描述来源 = workdir 下 CLAUDE.md 自动生成"（决策 D6）。同时 "群聊中，每个 Bot 的 Session 都会被注入所有在线 Bot 的描述"
- **Code has**: `desc.ts` 实现了两层描述:
  1. Bot 级描述 — `extractBotDescription()` 从 workdir CLAUDE.md 提取
  2. Skill 级描述 — `generateCapabilityDesc()` 从已安装 App 的 SKILL.md 提取
- **Issue**: spec 说 desc 注入的来源是 CLAUDE.md，但代码中实际从 SKILL.md 提取能力描述。这两种方式不矛盾（CLAUDE.md 提供整体定位，SKILL.md 提供具体能力），但 spec 没有明确描述这个两层结构
- **Recommendation**: 更新 spec，明确 desc 注入的来源是 "workdir CLAUDE.md（bot 定位）+ 已安装 App 的 SKILL.md（具体能力）"

---

### 30. Admin Token 认证

- **Status**: IMPLEMENTED
- **Spec says**: 未明确提及（但安全规则要求）
- **Code has**: `config.json` 中 `adminToken` 字段，Web server 在 `/api/admin/*` 路由上加 Bearer token 认证
- **Gap**: 无
- **Recommendation**: 无需变更

---

## 优先级排序

### P1 — 产品核心 (影响 v0 客户可用性)

1. **hospital-crm App 迁移** (#27) — v0 客户核心场景
2. **Web UI 在线代码编辑** (#14) — 管理员迭代的核心能力

### P2 — 产品完整度

3. **per-skill 调用统计** (#15) — 迭代闭环的数据基础
4. **desc 注入实时刷新** (#9) — 安装新 App 后无需重启
5. **App 三层结构深度一致性校验** (#23) — 工作流步骤 → CLI 映射
6. **app-scaffolder** (#24) — 降低新 App 创建成本
7. **WebSocket live feed** (#21) — 管理界面实时性

### P3 — 产品增强

8. **AI 洞察增强** (#14/#15) — 具体变更方案 + 模型配置化
9. **迭代效果追踪** (#16) — insight → 变更 → 效果对比
10. **群聊 desc 私聊跳过** (#9) — 减少不必要的 prompt 开销

### P4 — 长期

11. **配置加密存储** (#25) — 本地部署安全
12. **任务调度器** (#26) — 定时任务
13. **bid-crawler App** (#28) — 爬虫能力
14. **全局 skills/ 目录** (#12) — 跨 App skill 复用
15. **Skill 定义范围统一** (#4) — spec 说 "只声明接口" vs 实际含详细文档

---

## 与已有审计的对照

AUDIT-2026-05-03.md 聚焦于 **约束 (C1-C9)**、**设计决策 (D1-D15)**、**测试故事 (S1-S10)** 维度。本报告聚焦于 **spec 章节到代码实现的端到端映射**。

两份审计的结论一致：
- 核心架构（Channel 适配器、Bot 1:1 路由、Registry、Workdir）完全实现
- 飞书和钉钉的 Channel 适配完整且健壮
- 主要缺口在**领域 App 迁移**和**Web UI 编辑能力**
- 迭代闭环的数据层（analytics + insights）存在但需要 per-skill 粒度
