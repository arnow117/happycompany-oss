# HappyCompany 产品架构 v2

> 从 v1（统一数字员工）到 v2（企业-组织分层 + 工作流 + E2E 覆盖）

## 一、产品定位

多租户 AI 数字员工管理后台。管理员通过 Web 控制台创建、配置、监控、优化数字员工；真实企业员工通过飞书/钉钉入口发起会话，系统根据 userId、角色和个人助手绑定把请求路由到数字员工网络。

## 二、信息架构

### 侧边栏

```
┌ 当前企业: 示例医疗 ▼ ────┐
│                           │
│  ── 对话 ──               │
│  Chat, Sessions           │
│                           │
│  ── 企业 ──               │
│  技能市场     /skills-marketplace
│  知识库       /knowledge
│  工作流       /workflows       ← NEW
│                           │
│  ── 组织 ──               │
│  企业员工     /people
│  数字员工     /employees
│  推演沙盘     /dry-run
│  员工编排     /orchestration
│  入口路由     /entry-routing
│                           │
│  ── 系统 ──               │
│  Dashboard, Stats, Insights,
│  Config, AgentStatus, Scheduler
│                           │
│  ── 高级（折叠）──         │
│  Orchestration, ContractChain, Memory
│                           │
│  + 新建企业                │
└───────────────────────────┘

独立页: Login (/login), Setup (/setup), Onboarding (/onboarding), NotFound
```

### 页面职责

| 页面 | 路由 | 层级 | 职责 |
|------|------|------|------|
| 技能市场 | /skills-marketplace | 企业 | 技能包发布/安装/回滚 + 技能编辑 |
| 知识库 | /knowledge | 企业 | 企业共享知识文件的上传/查看/删除 |
| 工作流 | /workflows | 企业 | 流程指引（建议性）+ 执行 Trace + 指引vs实际对比 |
| 企业员工 | /people | 组织 | 同步钉钉通讯录，给真人 userId 分配角色和个人助手 |
| 数字员工 | /employees | 组织 | 员工列表/生成/分叉/优化 + 员工入职引导 + 模板浏览 |
| 入口路由 | /entry-routing | 组织 | 企业 IM/Web 入口状态 + 单入口 Bot 到数字员工网络的分发策略 |
| 企业入驻 | /onboarding | 独立 | 仅创建企业（砍掉旧 Step 2/3） |

### 概念边界

| 概念 | 说明 |
|------|------|
| 企业员工 | 真实组织成员，来自钉钉/飞书通讯录，有 `userId`、部门、角色、个人助手绑定 |
| 数字员工 | 可被路由到的工作主体，有 `role`、`tools`、`skills`、`workspace`、`humanUserId` |
| 入口路由 | 企业对外/对内接入点，通常是一个钉钉 Bot；不是每个员工一个 Bot，而是根据 userId 与绑定关系分发 |
| 企业调度员 | 当真人没有个人助手绑定，或问题需要跨角色协同时的 fallback 数字员工 |

## 三、数据模型

### 核心关系

```
corp/templates/                        ← 跨企业共享
├── roles/                             ← 角色模板
│   ├── sales.yaml                     ← systemPrompt + defaultTools + defaultSkills
│   └── maintenance.yaml
└── workdirs/                          ← 工作目录模板
    └── sales/                         ← .claude/skills/ + installed.json + 初始 memory

corp/{tenant}/
├── app.json                           ← 企业定义
├── roles.json                         ← 角色→工具权限（AuthGate 消费）
├── people.json                        ← 真实企业员工 userId / 部门 / 角色 / 个人助手绑定
├── employees/
│   └── sales-zhangsan.yaml            ← 数字员工（从角色模板 fork）
│         ├── systemPrompt ← 继承自模板
│         ├── tools[]     ← SkillBridge.resolveTools() → ToolRegistry
│         ├── humanUserId ← 绑定真人（定义了，AuthGate 未消费——待修）
│         └── workspace   ← EmployeeManager.resolveWorkspace() → agentDir
├── workflows/                         ← 统一工作流存储
└── processes/                         ← 流程蓝图 JSON（只读列表，待激活）
```

### 当前收口点

| 关系 | 当前状态 | 目标 |
|------|---------|------|
| `people.json` ↔ `roles.json` | 企业员工绑定角色时写入 `roles.json.users[userId]` | 角色权限和入口路由使用同一份身份映射 |
| `humanUserId` ↔ 入口路由 | 入口消息可按 DingTalk userId 匹配个人数字员工 | 未匹配时 fallback 到企业调度员 |
| Employee ↔ Workdir | workdir.ts 完全独立，未被 employee-colony 调用 | fork 员工时 `initWorkdirFromTemplate()` |
| 流程蓝图 ↔ 执行 Trace | processes/ 只有 list 端点，无业务逻辑 | Workflows 页统一展示指引+执行+对比 |

## 四、工作流

### 概念

工作流不是强制 BPM，而是**建议性指引**——AI 自主协商执行，可以偏离。系统自动记录实际执行，对比指引，发现偏离并给出优化建议。

### 三栏结构

```
工作流 (/workflows)

┌ 流程指引 ────────────────────────┐
│ 合同执行流程                       │
│   sales → maintenance → finance   │
│   说明: 签署后由维修进场，验收后财务结算  │
│   非强制，AI 可协商跳过或换人         │
├ 近期执行 ────────────────────────┤
│ 🔄 合同执行 #42  3m12s  偏离: 无   │
│ ⏸  合同执行 #38  停滞 2h          │
│ ✅ 维修工单 #15  偏离: 跳过验收     │
├ 指引 vs 实际 ────────────────────┤
│ 偏离检测 + 优化建议                 │
│ 偏离但更好 → 自动更新指引           │
│ 偏离且更差 → 标记为风险模式         │
└───────────────────────────────────┘
```

### 四个子系统

| 系统 | 引擎 | 位置 | 状态 |
|------|------|------|------|
| 编排工作流 | DynamicHandoffOrchestrator + SQLite ContractStore | handoff-engine.ts | ✅ 完善 |
| 表单工作流 | LLM 生成 → 人工确认 → SKILL.md | form-workflow-generator.ts | ✅ 功能有，未接模板 |
| 事件驱动 | EventBridge + MessageBus | event-bridge.ts | ✅ 完善 |
| 流程蓝图 | 仅文件列表 | processes/ 目录 | ❌ 占位符 |

## 五、工程变更清单

### 前端

| # | 文件 | 动作 | 要点 |
|---|------|------|------|
| 1 | `web/src/components/Layout.tsx` | 改 | 侧边栏重组为 5 组（对话/企业/组织/系统/高级） |
| 2 | `web/src/App.tsx` | 改 | + `/workflows` 路由 |
| 3 | `web/src/pages/Workflows.tsx` | 新建 | 指引 + Trace + 对比（复用 TraceViewer, GraphStats） |
| 4 | `web/src/pages/Employees.tsx` | 改 | + 员工入职流程 + 模板浏览；Trace 迁到 Workflows |
| 5 | `web/src/pages/Onboarding.tsx` | 改 | 精简为企业入驻（砍 Step 2/3） |
| 6 | `web/src/pages/EnterprisePeople.tsx` | 新建 | 企业员工同步 + 角色/个人助手绑定 |
| 7 | `web/src/pages/Bots.tsx` | 改 | 转为入口路由状态页（单企业入口 Bot + 内部分发） |
| 8 | `web/src/lib/api.ts` | 改 | + 企业员工/模板/工作流 API 方法 |
| 8 | `web/src/stores/chat.ts` | 可选 | tenant 状态扩展 |

### 后端

| # | 文件 | 动作 | 要点 |
|---|------|------|------|
| 9 | `src/orchestrator/employee-api.ts` | 改 | + 模板 list/fork, bot 绑定, trace 对比 |
| 10 | `src/routes/admin-tenants.ts` | 改 | 创建企业自动建 `workflows/` 目录 |
| 11 | `src/routes/enterprise-people.ts` | 新建 | 企业员工 list/sync/bind API |
| 12 | `src/workdir.ts` | 改 | + `initWorkdirFromTemplate()` |
| 13 | `src/web.ts` | 改 | 注册企业员工和入口路由相关路由 |
| 14 | `src/index.ts` | 微调 | 入口消息按 userId 路由到个人助手或企业调度员 |
| 15 | `src/routes/templates.ts` | 新建/可选 | 角色模板 list/get（或并入 employee-api） |

### 新目录结构

```
corp/
├── templates/
│   ├── roles/sales.yaml, maintenance.yaml, finance.yaml, admin.yaml
│   └── workdirs/sales/, maintenance/, finance/
└── {tenant}/
    ├── people.json          ← 企业员工绑定
    ├── employees/           ← 已有
    ├── workflows/           ← 新建
    └── processes/           ← 已有
```

## 六、E2E 测试体系（21 stories, 4 phases）

### P1: 基石（5 stories）

| # | Story | 旅程 | 关键断言 |
|---|-------|------|---------|
| 1 | Setup | 未配置→Setup 向导→Dashboard | Step 验证、渠道切换、payload 捕获 |
| 2 | Login | /login → 成功/失败 → Dashboard | Token 输入、401 重定向、错误提示 |
| 3 | Dashboard | / + WebSocket 实时事件 | 入口状态、消息汇总、WS 连接状态 |
| 4 | Navigation | 侧边栏全路由 | 每个链接路由正确、折叠/展开、暗色模式 |
| 5 | 404 | /bad-route, /login | 404 不崩溃、Login 独立布局 |

### P2: 企业日常（7 stories）

| # | Story | 旅程 | 关键断言 |
|---|-------|------|---------|
| 6 | Enterprise Onboarding | 3 步入驻向导 | Slug 校验、角色预览、POST tenant、跳转 |
| 7 | Skills Browse | 市场列表→详情→README→文件→脚手架 | 表格渲染、版本历史、弹窗 |
| 8 | Skills Publish | 发布→列表更新→安装→回滚 | 表单提交、版本切换、错误解除 |
| 9 | Knowledge Base | 文件列表→查看→删除确认 | Bot 选择器、空状态、确认对话框 |
| 10 | Workflow Guidance | 流程指引 CRUD + AI 建议 | 步骤编辑器、保存、建议 badge |
| 11 | Workflow Traces | 执行 Trace 列表→详情→对比 | Trace 列表、指引vs实际 diff、偏离标记 |
| 12 | Workflow Autonomous Routing | 编排 Agent 拆解任务→按数字员工职责动态路由 | 自主路由说明、职责匹配理由、拆解子任务、路由链、交接次数 |

### P3: 组织日常（6 stories）

| # | Story | 旅程 | 关键断言 |
|---|-------|------|---------|
| 13 | Enterprise People | 同步通讯录→分配角色→绑定/解绑个人助手 | userId、部门、角色、个人助手、roles.json 同步 |
| 14 | Employee List | Auto-seed→卡片→Tab 切换 | 卡片字段、角色 badge、统计面板 |
| 15 | Employee Fork | Fork 按钮→弹窗→角色选择→提交 | 模态框交互、API payload、新卡片渲染 |
| 16 | Employee Generate | NL 输入→生成→卡片出现 | 按钮状态、API 调用、错误处理 |
| 17 | Entry Routing | 入口列表→查看企业/路由模式→进入聊天 | 状态 badge、入口模式、企业调度员 fallback |
| 18 | Entry Chat | 员工通过企业入口连续聊两句 | WebSocket 发送、入口 workdir、两轮回复、路由语义 |

### P4: 高级与防御（3 stories）

| # | Story | 旅程 | 关键断言 |
|---|-------|------|---------|
| 19 | Orchestration | 编排运行→合约树→路由→取消 | Run 表单、合约状态、路由日志 |
| 20 | Scheduler | 任务 CRUD + 触发 | 调度类型切换、表单验证、删除确认 |
| 21 | Error States | 空状态 + API 500 + 网络故障 | 占位文本、错误横幅、恢复按钮 |

### 测试基础设施

- **框架**: Playwright + TypeScript
- **默认门禁路径**: `web/e2e/story-v2-*/**/*.spec.ts`
- **配置**: `web/playwright.config.ts`（testMatch: `**/story-v2-*/**/*.spec.ts`）
- **历史资产**: `web/e2e/story-a-*` ~ `story-q-*` 仍保留为旧页面回归参考，不纳入默认 `npm run test:e2e` 门禁；迁移时应按本 PID 的产品域重新合并到 v2 journey。
- **辅助函数**: `mockAuth`, `mockUnconfigured`, `mockWebSocket`, `mockApiError`, `mockNetworkFailure`
- **种子数据**: `scripts/seed-e2e.mjs`

## 七、E2E 迁移对照

| 旧 Story | 状态 | 新 Story |
|----------|------|---------|
| story-a-app-lifecycle | ❌ 删 | 合并到 story-7/8（技能市场） |
| story-b-bot-workdir | ✅ 留 | story-16（入口路由） |
| story-c-iteration-loop | ⚠️ 改 | Stats+Insights 部分保留 |
| story-d-admin-patrol | ❌ 删 | 侧边栏变更，巡检逻辑已过时 |
| story-digital-employees | ❌ 删 | story-12~15（员工管理） |
| story-e-first-run | ✅ 留 | story-1（Setup） |
| story-f-login | ✅ 留 | story-2（Login） |
| story-g-knowledge-base | ✅ 留 | story-9（知识库） |
| story-h-sessions | ✅ 留 | 纳入 story-4（Navigation） |
| story-i-scheduler | ✅ 留 | story-18（Scheduler） |
| story-j-chat | ✅ 留 | 纳入对话域 |
| story-k-cross-page | ⚠️ 改 | story-4（Navigation 重写） |
| story-l-multi-bot | ✅ 留 | 纳入入口路由域 |
| story-m-scheduler-edges | ✅ 留 | story-18 |
| story-n-apps-publish | ⚠️ 改 | story-7/8（技能市场） |
| story-o-read-only-pages | ⚠️ 改 | story-9/16/19 |
| story-p-insights-build | ⚠️ 改 | Insights 留，Build 删 |
| story-q-chat-websocket | ✅ 留 | 纳入对话域 |
| story-z-doc-screenshots | ⚠️ 改 | 更新路由引用 |

## 八、实施阶段

| Phase | 内容 | 预计改动 |
|-------|------|---------|
| A: 侧边栏 + 路由 | Layout.tsx + App.tsx + api.ts | ~3 文件 |
| B: 工作流页 | Workflows.tsx（新建）+ 后端 workflow API | ~3 文件 |
| C: 员工入职 | Employees.tsx 改 + 模板 API + workdir 模板 | ~5 文件 |
| D: 企业员工 + 入口路由 | EnterprisePeople.tsx + Bots.tsx + enterprise-people 后端 | ~6 文件 |
| E: E2E | 19 stories 逐步覆盖 | ~19 spec 文件 |
