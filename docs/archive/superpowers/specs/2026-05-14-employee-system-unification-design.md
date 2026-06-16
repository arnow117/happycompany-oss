# 数字员工体系统一重构

## 目标

消掉 APP/Demo 双轨制，统一为「数字员工（Employee）」体系，消掉 `demo/` 目录，合并前端冗余页面，加入企业入驻引导。

## 核心原则

1. **一个概念一个名字** — `EmployeeDefinition` 是数字员工的唯一类型
2. **demo 不是 demo** — 它已经是生产系统，合并进 orchestrator
3. **少文件 > 多文件** — 前端页面合并，不保留过渡期别名
4. **机械改动不改逻辑** — import 重命名/路径调整，不动业务代码
5. **遇冲突优先此原则判断**，超出则请求用户

## 命名映射

| 旧名 | 新名 | 位置变化 |
|------|------|---------|
| `AppDefinition` | `EmployeeDefinition` | orchestrator/app-schema.ts → orchestrator/employee-schema.ts |
| `DemoAgent` | 合并入 `EmployeeDefinition` | demo/types.ts → 删除 |
| `AppDefinitionLoader` | `EmployeeLoader` | orchestrator/app-loader.ts → orchestrator/employee-loader.ts |
| `LoadedApp` | `LoadedEmployee` | 同上 |
| `AgentColonyManager` | `EmployeeManager` | orchestrator/agent-colony.ts → orchestrator/employee-colony.ts |
| `ColonyAgent` | `RegisteredEmployee` | 同上 |
| `AppInfo` | `SkillPackage` | 前端 api.ts |
| `/api/demo/*` | `/api/employees/*` | demo/demo-api.ts → web.ts 内 |
| `corp/{t}/apps/` | `corp/{t}/employees/` | 文件系统 |

## Phase A: 后端类型合并

### A1. 新建 `orchestrator/employee-schema.ts`

合并 `app-schema.ts` 的 Zod schema + `demo/types.ts` 的字段，新增 `source`/`createdAt` 等 demo 侧独有字段：

```ts
// 合并后的 EmployeeDefinition（在原有 AppDefinition 基础上加）
source: 'generated' | 'prepopulated' | 'forked'  // 来源
createdAt: number                                  // 创建时间
```

### A2. 文件操作

```
新建:  orchestrator/employee-schema.ts
改名:  orchestrator/app-loader.ts    → employee-loader.ts
改名:  orchestrator/agent-colony.ts   → employee-colony.ts
迁移:  demo/agent-generator.ts       → orchestrator/employee-generator.ts
迁移:  demo/trace-store.ts           → orchestrator/trace-store.ts
迁移:  demo/skill-factory.ts         → orchestrator/skill-factory.ts
迁移:  demo/form-workflow-generator.ts → orchestrator/
迁移:  demo/workflow-doc-extractor.ts  → orchestrator/
合并:  demo/demo-api.ts              → web.ts 内 /api/employees/*
删除:  demo/ 整个目录
```

### A3. Import 路径更新（15 个文件）

```
src/index.ts            — loader, colony, trace-store, workdir imports
src/web.ts              — demo imports → employee imports + routes
src/business-api.ts     — agent-colony → employee-colony
src/routes/public-routes.ts — 同上
src/routes/admin-apps.ts — workdir types
orchestrator/orchestrator-runner.ts — trace-store path
orchestrator/event-bridge.ts — app-schema → employee-schema
orchestrator/skill-bridge.ts  — 同上
```

## Phase B: 存储对齐

```bash
corp/{tenant}/apps/*.yaml → corp/{tenant}/employees/*.yaml
```

`employee-loader.ts` 加载路径从 `{corpDir}/{tenant}/apps/` 改为 `{corpDir}/{tenant}/employees/`。

向前兼容：启动时检查 `apps/` 目录是否存在但 `employees/` 不存在，自动 rename。

## Phase C: 前端统一

### C1. 页面合并

```
DigitalEmployees.tsx + Build.tsx → Employees.tsx
  - 主视图：员工卡片列表（原 DigitalEmployees）
  - Tab: 「新建员工」— NL 描述生成（原 Build 功能）

Apps.tsx + Skills.tsx → SkillsMarketplace.tsx
  - 主视图：技能包列表（原 Apps 的 publish/install/rollback）
  - Tab: 「技能编辑」（原 Skills 的 create/edit）
```

### C2. 路由更新（App.tsx）

```
删除: /apps, /build, /skills, /digital-employees
新增: /employees, /skills-marketplace
保留: /bots, /chat, /config, /setup, /sessions, /scheduler,
      /stats, /insights, /memory, /knowledge, /agent-status,
      /contract-chain, /orchestration, /dry-run, /login
```

### C3. 侧边栏更新（Layout.tsx）

```
原: 📱 应用 | 🧩 Skills | 🔧 Build | 👥 数字员工
新: 👥 数字员工 | 📦 技能市场
```

### C4. API 客户端更新（api.ts）

```
DemoAgent → Employee
AppInfo → SkillPackage
listDemoAgents() → listEmployees()
generateDemoAgent() → generateEmployee()
forkDemoAgent() → forkEmployee()
etc.
```

## Phase D: 企业入驻引导

### D1. 后端 API

```
POST /api/tenants
  body: { name, displayName, description }
  → 创建 corp/{name}/ 目录 + app.json + roles.json（默认模板）
  → 返回 tenant info

POST /api/employees
  body: { tenant, description }
  → NL → YAML（复用 employee-generator）
  → 写入 corp/{tenant}/employees/{id}.yaml
  → EmployeeLoader.reload()
  → 返回 EmployeeDefinition
```

### D2. 前端引导流程

三步向导：
1. **企业信息** — 企业名、描述
2. **角色定义** — 默认角色模板（管理员/员工/只读），可编辑
3. **首个员工** — NL 描述生成第一个数字员工

完成后跳转到 `/employees`。

### D3. 接入点

- Setup 页面完成后如果没有企业 → 自动跳转引导
- 侧边栏「+ 新建企业」入口
- 数字员工页面「+ 新建员工」按钮

## Phase E: 测试修复

受影响 15 个测试文件，全部是 import 路径 + API 路由 + 类型名对齐：

```
tests/demo-api.test.ts
tests/env-guard.test.ts
tests/orchestrator/app-schema.test.ts
tests/orchestrator/app-schema-event.test.ts
tests/orchestrator/app-loader.test.ts
tests/orchestrator/app-e2e.test.ts
tests/orchestrator/agent-colony.test.ts
tests/orchestrator/event-bridge.test.ts
tests/orchestrator/platform-admin-app.test.ts
tests/integration-colony.test.ts
tests/integration-colony-reload.test.ts
tests/integration-event-bridge.test.ts
tests/integration-platform-admin.test.ts
tests/integration-scheduler-event-pipeline.test.ts
tests/business-api.test.ts
tests/phase5-integration.test.ts
```

## 执行策略

一个 PR，5 个 commit 推进：
1. `refactor: phase A — 后端类型合并 + demo/ 删除`
2. `refactor: phase B — 存储路径 apps/ → employees/`
3. `refactor: phase C — 前端页面合并 + API 对齐`
4. `feat: phase D — 企业入驻引导`
5. `test: phase E — 测试修复 + 全量回归`

每个 commit 前执行：`tsc --noEmit && vitest run && npm run build`（web/）。

## 失败回滚

- 任意 commit 不通过检查清单 → 修复后继续，不跳步
- 超出原则范围的判断 → 请求用户
- Git 状态保持干净，不 squash 到中途
