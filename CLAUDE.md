# happycompany

数字员工平台 — 定义数字员工 YAML → 连接钉钉/飞书/Web → 处理真实业务。

## 核心文档

| 文件 | 内容 |
|------|------|
| [docs/specs/2026-05-21-architecture-overview.md](docs/specs/2026-05-21-architecture-overview.md) | 当前架构总览（模块、数据流、API） |
| [docs/adr/2026-05-11-002-digital-employee-demo.md](docs/adr/2026-05-11-002-digital-employee-demo.md) | ADR-002 数字员工系统设计 |
| [docs/adr/2026-05-21-003-dispatcher-as-router-fork-instances.md](docs/adr/2026-05-21-003-dispatcher-as-router-fork-instances.md) | ADR-003 调度员退化为纯路由层 |
| [docs/adr/2026-06-04-005-runtime-profile-worktree-isolation.md](docs/adr/2026-06-04-005-runtime-profile-worktree-isolation.md) | ADR-005 worktree runtime profile 隔离 |
| [docs/specs/2026-05-21-agent-dreaming-design.md](docs/specs/2026-05-21-agent-dreaming-design.md) | Agent 自动学习设计 |
| [docs/guides/operations.md](docs/guides/operations.md) | 运维部署（PM2、前端调试、部署流程） |

> 历史文档已归档至 `docs/archive/`

## 端口

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 (Vite) | **8888** | `web/vite.config.ts`，API 请求 proxy 到后端 |
| 后端 (Hono) | **3100** | `config.json` → `web.port` |

多 worktree 并行研发时可以偏移端口，但必须通过 runtime profile 和环境变量成对配置，不能随手起临时端口。

```bash
npm run dev:profile -- feat-builder
cd web && HAPPYCOMPANY_WEB_PORT=8891 HAPPYCOMPANY_API_PORT=3101 npm run dev
```

## 技术栈

- **后端**: Node.js + TypeScript + Hono + Claude Agent SDK
- **前端**: React + TypeScript + Vite + Zustand
- **测试**: Vitest (90 文件, ~1094 测试) + Playwright E2E
- **Python 集成**: 租户 skill package 通过 JSON-RPC 或 CLI 通信

## 项目结构

```
happycompany/
├── src/                     # 后端（见 src/CLAUDE.md）
│   ├── index.ts             # 主入口
│   ├── agent.ts             # ClaudeAgent — LLM session
│   ├── bot.ts               # BotManager — 路由 + 去重
│   ├── auth-gate.ts         # RBAC deny-by-default
│   ├── enterprise-routing.ts # people.json → 员工实例
│   ├── orchestrator/        # 编排器子系统（20 模块）
│   ├── prompts/             # Prompt 模板系统
│   └── routes/              # Admin API 路由
├── web/                     # 前端（见 web/CLAUDE.md）
│   └── src/
│       ├── pages/           # 18 页面
│       ├── stores/          # Zustand
│       └── lib/api.ts       # API 客户端
├── corp/templates/          # 平台行业模板（可进 Git）
├── tests/                   # 90 文件，~1094 测试
└── justfile                 # Task runner（just server/web check/pre-pr）
```

## 数据目录与企业实例

当前本机开发配置在 `config.json` 中显式设置：

```json
{
  "corpDir": "../corp"
}
```

因此平台运行时扫描的企业根目录是：

```text
/workspace/corp/
```

当前 HappyCompany 使用的示例医疗企业实例不是上层已有的 `acme`，而是：

```text
../corp/acme-happycompany/
```

`config.json` 中 `web-bot` 和 `acme-dingtalk` 的 `tenant` 都应指向 `acme-happycompany`。上层原有 `../corp/acme/` 保留为历史/独立企业目录，不要覆盖。

目录职责：

```text
happycompany/corp/templates/      # 平台模板源，随主仓版本管理
../corp/templates/                # 当前本机运行时可扫描的模板副本
../corp/acme-happycompany/     # 当前平台使用的示例医疗企业实例
../corp/acme-demo/                # 演示企业实例
data/                             # 平台运行状态：messages.db、contracts.db、registry、加密 key
```

企业实例结构：

```text
../corp/{tenant}/
├── app.json
├── roles.json
├── people.json
├── employees/
├── agents/
├── .claude/skills/
├── workflows/
└── processes/
```

解析优先级：`HAPPYCOMPANY_CORP_DIR` > `config.json.corpDir` > 仓库内 `corp/` > 上级 `../corp`。改企业目录后必须重启后端，`src/index.ts` 启动时会把 `corpDir` 读入内存。

## Worktree Runtime Profile

多 worktree 研发必须隔离运行态，而不是只隔离 Git 分支。使用 `--profile <name>` 或 `HAPPYCOMPANY_PROFILE=<name>` 时，后端默认读取 `.runtime/<name>/config.json`；profile 内相对 `dataDir` 和 `corpDir` 以 `.runtime/<name>/` 为根解析。

```bash
# 后端
npm run dev:profile -- feat-builder

# 显式配置文件
HAPPYCOMPANY_CONFIG=.runtime/feat-builder/config.json npx tsx src/index.ts
```

Rationale: `data/` 包含 SQLite、registry、记忆和加密 key；`corpDir` 包含企业员工、skill package、流程和企业数据。多个 worktree 共用这些目录会造成数据串写、schema 污染和真实业务误回复。

Worktree profile 的 `web.port` 必须和前端 `HAPPYCOMPANY_API_PORT` 对齐；`HAPPYCOMPANY_WEB_PORT` 只控制 Vite/E2E 前端端口。

## 研发规范

### 前端修改后必须重新构建

前端改动（web/src/）必须 build 后才能在 3100 端口看到效果。后端 serve 的是 `web/dist/` 静态文件。

```bash
cd happycompany/web && npm run build
```

### 不要用临时端口启动 Vite dev server

项目端口是 **8888**。开发时 8888 是 HMR 热更新，最终效果以 build 后 3100 为准。

### 测试必须在项目根目录运行

```bash
cd happycompany && npx vitest run   # 正确：90 文件，~1094 测试
cd happycompany/web && npx vitest run # 错误：缺少路径上下文
```

### 提交前检查

```bash
just check          # 快速：只检查改动涉及的 domain
just pre-pr          # 完整：tsc + build + vitest + E2E
```

### 迭代工作流

| 场景 | Skill | 阶段 |
|------|-------|------|
| 研发需求 | `/hp-feature-dev` | Explore → Design → Spec → TestPlan → Implement → Verify |
| Bug 修复 | `/hp-bugfix` | Reproduce → Diagnose → Classify → Fix → Verify |

前端功能迭代、UI/流程 bug、路由/信息架构变化、发布/demo/review 都必须触发 `/happycompany-e2e`：

- TestPlan/Verify 阶段做 E2E Diff Review：Add / Update / Delete / Reclassify。
- UI/流程 bug 先写最小 Probe 复现，再修复，再决定 Promote/Delete。
- 发布/demo/review 需要生成 `docs/reports/*-e2e-story-review.html` 产品故事报告。

Verify 阶段包含 Playwright E2E。前端页面改动必须通过 E2E 验证。E2E 位于 `web/e2e/`：

```bash
cd happycompany/web && npm run test:e2e:mainline
```

### Commit 规范

- `feat(web):` 前端新功能
- `fix(web):` 前端修复
- `refactor(web):` 前端重构
- `test:` 测试
- `fix:` 后端修复
- `feat(orchestrator):` 编排器功能

## Prohibitions

| # | 禁止 | Rationale: 为什么 |
|---|------|-------------------|
| X1 | 不新增 `any` 类型 | 项目 0 处 any，保持。用 `unknown` + narrowing |
| X2 | 不硬编码租户路径 | 用 `tenant.ts` 的 `getTenantDir()`，确保多租户兼容 |
| X3 | 不在 routes 中直接调用 Anthropic SDK | 走 `ClaudeAgent`，确保 session 一致和 token 追踪 |
| X4 | 不从外部直接 import orchestrator/ 内部模块 | orchestrator 只通过 runner/api 入口暴露 |
| X5 | Zustand selector 不返回新建引用 | `filter()` 等导致无限重渲染，用 `useMemo` 派生 |
| X6 | 不让多个 worktree 共用 `dataDir`/`corpDir` | 运行态比代码更容易互相污染。用 runtime profile 隔离 |

## CLAUDE.md Governance

- CLAUDE.md 只记录同时满足三点的规则：项目特有、代码里不明显、违反代价高。
- 每条新增规则必须有 Rationale 或能在同一段说明为什么；不能只写偏好。
- 子目录 CLAUDE.md 只能新增或收紧父级规则，不能放宽或重复父级规则。
- 架构约束变化必须在同一次改动里更新对应 CLAUDE.md 和 ADR/spec，不能让下一个 agent 读到旧规则。
- 每个里程碑运行 `just review` 时顺手清理过期规则。默认姿态是删除可从代码推断出的规则。

Rationale: CLAUDE.md 是 agent 的高优先级上下文。陈旧、重复或没有理由的规则比没有规则更危险，会把下一轮研发带偏。

## Self-Check Triggers

- **"加个 console.log 调试"** → 用 `logger` (Pino)。项目 0 处 console.log，保持。
- **"这个模块只改这一个文件"** → 是不是在避开一个该做的重构？
- **"直接 import orchestrator 的内部文件"** → 只能用 orchestrator-runner 和 employee-api。
- **"新建一个 Zustand store"** → 当前只有 chat.ts。确定需要新 store 而非扩展？
- **"我开个 worktree 跑一下"** → 是否已经分配独立 `.runtime/<profile>/data`、`.runtime/<profile>/corp` 和端口？
- **"改了架构但 CLAUDE.md 先不动"** → Same-PR 规则：架构约束和 agent 上下文必须同改。

## 启动

```bash
# 后端
cd happycompany && npm run dev

# 前端（另一个终端）
cd happycompany/web && npm run dev
# 访问 http://localhost:8888

# 测试
cd happycompany && npx vitest run
```
