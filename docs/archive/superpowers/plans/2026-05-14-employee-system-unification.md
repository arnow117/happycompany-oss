# 数字员工体系统一重构 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消掉 APP/Demo 双轨制，统一为 Employee 体系，合并前端冗余页面，加入企业入驻引导。

**Architecture:** 5 个 commit 推进 — 后端类型合并 → 存储迁移 → 前端对齐 → 企业引导 → 测试修复。每个 commit 都是原子性的纯机械改动，不改业务逻辑。

**Tech Stack:** TypeScript + Hono + Zod + React + Vite + Zustand + Vitest

---

## Commit 1: `refactor: phase A — 后端类型合并 + demo/ 删除`

### Task A1: 新建合并后的 EmployeeDefinition schema

**Files:**
- Create: `src/orchestrator/employee-schema.ts`
- Reference: `src/orchestrator/app-schema.ts` (existing fields)
- Reference: `src/demo/types.ts` (fields to merge in)

- [ ] **Step 1: 创建 employee-schema.ts**

把 `app-schema.ts` 的 Zod schema 复制出来，加上 `demo/types.ts` 里 `DemoAgent` 独有的字段（`source`, `createdAt`）。

```typescript
import { z } from 'zod';

const scheduleTriggerSchema = z.object({
  type: z.enum(['cron', 'interval', 'once', 'event']),
  value: z.string(),
  prompt: z.string(),
  enabled: z.boolean().default(true),
}).refine(t => t.type !== 'event' || (t.value && t.value.length > 0), {
  message: 'Event trigger must have a non-empty value',
  path: ['value'],
});

const scheduleSchema = z.object({
  triggers: z.array(scheduleTriggerSchema).default([]),
});

const retrySchema = z.object({
  maxRetries: z.number().int().min(0).default(3),
  maxModelRetries: z.number().int().min(0).default(5),
});

export const employeeDefinitionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().default(''),
  model: z.string().default(''),
  systemPrompt: z.string().default(''),
  maxTurns: z.number().int().min(1).default(50),
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  workspace: z.string().default(''),
  role: z.string().default(''),
  schedule: scheduleSchema.optional(),
  allowedTargets: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]).describe(
    'Keywords describing what this agent can solve (e.g. "合同", "发票", "维修"). Used by the dispatcher for routing.',
  ),
  retry: retrySchema.optional(),
  channel: z.enum(['dingtalk', 'feishu']).optional(),
  channelConfig: z.record(z.string(), z.unknown()).optional(),
  humanUserId: z.string().optional().describe(
    'DingTalk user ID of the real person this agent represents.',
  ),
  // Merged from DemoAgent
  source: z.enum(['generated', 'prepopulated', 'forked']).default('prepopulated'),
  createdAt: z.number().default(() => Date.now()),
});

export type EmployeeDefinition = z.infer<typeof employeeDefinitionSchema>;

// Compatibility alias — remove after all consumers updated
export type AppDefinition = EmployeeDefinition;
```

- [ ] **Step 2: 验证编译**

```bash
cd happycompany && npx tsc --noEmit
```

Expected: PASS (new file has no consumers yet, so no breakage).

---

### Task A2: 改名 app-loader → employee-loader

**Files:**
- Rename: `src/orchestrator/app-loader.ts` → `src/orchestrator/employee-loader.ts`

- [ ] **Step 1: 创建 employee-loader.ts**

复制 `app-loader.ts` 内容，做以下替换：
- `AppDefinition` → `EmployeeDefinition`
- `appDefinitionSchema` → `employeeDefinitionSchema`
- `LoadedApp` → `LoadedEmployee`
- `AppLoaderOptions` → `EmployeeLoaderOptions`
- `AppDefinitionLoader` → `EmployeeLoader`
- import from `'./employee-schema.js'`
- YAML 加载路径从 `apps` → `employees`（但要放到 Task B1 才真正改目录名，这里先改代码路径）

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { logger } from '../logger.js';
import { employeeDefinitionSchema, type EmployeeDefinition } from './employee-schema.js';

export interface LoadedEmployee extends EmployeeDefinition {
  tenantName: string;
  filePath: string;
  loadedAtMs: number;
}

export interface EmployeeLoaderOptions {
  corpDir: string;
}

export interface ReloadResult {
  added: LoadedEmployee[];
  removed: LoadedEmployee[];
  changed: LoadedEmployee[];
  unchanged: LoadedEmployee[];
}

export class EmployeeLoader {
  constructor(private readonly options: EmployeeLoaderOptions) {}

  load(): LoadedEmployee[] {
    const { corpDir } = this.options;
    const results: LoadedEmployee[] = [];

    if (!fs.existsSync(corpDir)) {
      logger.warn({ corpDir }, 'corp directory does not exist');
      return results;
    }

    const tenants = fs.readdirSync(corpDir, { withFileTypes: true });
    for (const tenant of tenants) {
      if (!tenant.isDirectory()) continue;
      const tenantApps = this.loadTenant(tenant.name);
      results.push(...tenantApps);
    }

    logger.info({ appCount: results.length }, 'EmployeeLoader scan complete');
    return results;
  }

  loadTenant(tenantName: string): LoadedEmployee[] {
    const { corpDir } = this.options;
    const employeesDir = path.join(corpDir, tenantName, 'employees');

    if (!fs.existsSync(employeesDir)) {
      // Backward compat: check old apps/ path
      const legacyDir = path.join(corpDir, tenantName, 'apps');
      if (fs.existsSync(legacyDir)) {
        return this.loadFromDir(legacyDir, tenantName);
      }
      return [];
    }

    return this.loadFromDir(employeesDir, tenantName);
  }

  private loadFromDir(dir: string, tenantName: string): LoadedEmployee[] {
    const results: LoadedEmployee[] = [];
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
      const filePath = path.join(dir, entry);
      if (!fs.statSync(filePath).isFile()) continue;

      const loaded = this.parseFile(filePath, tenantName);
      if (loaded) {
        results.push(loaded);
      }
    }

    return results;
  }

  reload(previous: LoadedEmployee[]): ReloadResult {
    const current = this.load();
    const previousMap = new Map(previous.map((app) => [app.filePath, app]));
    const currentPaths = new Set(current.map((app) => app.filePath));

    const added: LoadedEmployee[] = [];
    const changed: LoadedEmployee[] = [];
    const unchanged: LoadedEmployee[] = [];
    const removed: LoadedEmployee[] = [];

    for (const app of current) {
      const prev = previousMap.get(app.filePath);
      if (!prev) {
        added.push(app);
      } else {
        const curMtime = fs.statSync(app.filePath).mtimeMs;
        if (prev.loadedAtMs !== curMtime) {
          changed.push(app);
        } else {
          unchanged.push(prev);
        }
      }
    }

    for (const app of previous) {
      if (!currentPaths.has(app.filePath)) {
        removed.push(app);
      }
    }

    return { added, removed, changed, unchanged };
  }

  private parseFile(filePath: string, tenantName: string): LoadedEmployee | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseYaml(raw);
      if (!parsed || typeof parsed !== 'object') {
        logger.warn({ filePath }, 'YAML file is empty or not an object, skipping');
        return null;
      }
      const validated = employeeDefinitionSchema.parse(parsed);
      const loadedAtMs = fs.statSync(filePath).mtimeMs;
      return {
        ...validated,
        tenantName,
        filePath,
        loadedAtMs,
      };
    } catch (err) {
      logger.warn({ filePath, err }, 'Failed to parse employee YAML config, skipping');
      return null;
    }
  }
}
```

注意：`loadTenant` 方法里已加向后兼容——检查 `employees/` 目录不存时回退到 `apps/`。

- [ ] **Step 2: 验证编译**

```bash
cd happycompany && npx tsc --noEmit
```

Expected: 旧文件还在，新文件无消费者 → PASS。可能有一个 re-export 的 `AppDefinition` 别名产生 unused warning。

- [ ] **Step 3: 删除旧 app-loader.ts**

```bash
rm src/orchestrator/app-loader.ts
```

- [ ] **Step 4: 更新所有 consumer 的 import 路径**

更新以下文件的 import：

`src/index.ts:28`:
```typescript
// OLD:
import { AppDefinitionLoader } from './orchestrator/app-loader.js';
// NEW:
import { EmployeeLoader } from './orchestrator/employee-loader.js';
```

同时更新 `index.ts:181-182` 的使用：
```typescript
// OLD:
const appLoader = new AppDefinitionLoader({ corpDir });
const loadedApps = appLoader.load();
// NEW:
const employeeLoader = new EmployeeLoader({ corpDir });
const loadedEmployees = employeeLoader.load();
```

更新所有后续引用 `loadedApps` → `loadedEmployees`，`appLoader` → `employeeLoader`。

`src/orchestrator/agent-colony.ts:1`:
```typescript
// OLD:
import type { LoadedApp } from './app-loader.js';
// NEW:
import type { LoadedEmployee } from './employee-loader.js';
```

同时更新 agent-colony.ts 内部所有 `LoadedApp` → `LoadedEmployee`。

`src/orchestrator/event-bridge.ts` — 更新 app-loader import。

`src/demo/demo-api.ts:7-8` — 更新 import:
```typescript
// OLD:
import type { LoadedApp } from '../orchestrator/app-loader.js';
import type { AppDefinition } from '../orchestrator/app-schema.js';
// NEW:
import type { LoadedEmployee } from '../orchestrator/employee-loader.js';
import type { EmployeeDefinition } from '../orchestrator/employee-schema.js';
```

- [ ] **Step 5: 编译验证**

```bash
cd happycompany && npx tsc --noEmit
```

Expected: PASS。有类型错误就逐个修复。

---

### Task A3: 改名 agent-colony → employee-colony

**Files:**
- Rename: `src/orchestrator/agent-colony.ts` → `src/orchestrator/employee-colony.ts`
- Modify: ~6 consumer files

- [ ] **Step 1: 创建 employee-colony.ts**

复制 `agent-colony.ts`，替换：
- `LoadedApp` → `LoadedEmployee`
- `ColonyAgent` → `RegisteredEmployee`
- `ColonyDeps` → `EmployeeManagerDeps`
- `AgentColonyManager` → `EmployeeManager`
- `ClaudeAgentAdapter` → `AgentAdapter`
- import from `'./employee-loader.js'`

所有内部变量名也更新：`agents` → `employees`，`app` → `employee`。

- [ ] **Step 2: 更新所有 consumer**

更新 import 路径和类名：

```
src/index.ts           — AgentColonyManager → EmployeeManager
src/web.ts             — AgentColonyManager → EmployeeManager
src/business-api.ts    — 同上
src/routes/public-routes.ts — 同上
src/orchestrator/orchestrator-runner.ts — 同上
src/demo/demo-api.ts   — 同上
```

例如 `src/index.ts:184-192`:
```typescript
// OLD:
const colony = new AgentColonyManager({...});
// NEW:
const employeeManager = new EmployeeManager({...});
```

- [ ] **Step 3: 删除旧文件 + 编译验证**

```bash
rm src/orchestrator/agent-colony.ts
cd happycompany && npx tsc --noEmit
```

Expected: PASS.

---

### Task A4: 迁移 demo/ 文件到 orchestrator/

**Files:**
- Move: `src/demo/trace-store.ts` → `src/orchestrator/trace-store.ts`
- Move: `src/demo/agent-generator.ts` → `src/orchestrator/employee-generator.ts`
- Move: `src/demo/skill-factory.ts` → `src/orchestrator/skill-factory.ts`
- Move: `src/demo/form-workflow-generator.ts` → `src/orchestrator/form-workflow-generator.ts`
- Move: `src/demo/workflow-doc-extractor.ts` → `src/orchestrator/workflow-doc-extractor.ts`

- [ ] **Step 1: 迁移 trace-store.ts**

```bash
cp src/demo/trace-store.ts src/orchestrator/trace-store.ts
```

更新 import 链：
- `src/index.ts:37` — `'./demo/trace-store.js'` → `'./orchestrator/trace-store.js'`
- `src/web.ts:34` — 同上
- `src/orchestrator/orchestrator-runner.ts:9` — `'../demo/trace-store.js'` → `'./trace-store.js'`

- [ ] **Step 2: 迁移 employee-generator.ts**

重写 import，schema 从 `employee-schema.ts` 引入，去掉对 `demo/types.ts` 的依赖。把类型引用改为 `employee-schema.ts` 里的 `EmployeeDefinition`。

```bash
cp src/demo/agent-generator.ts src/orchestrator/employee-generator.ts
```

文件内替换：
- `DemoAgent` → `EmployeeDefinition`（从新 schema 导入）
- `appDefinitionSchema` → `employeeDefinitionSchema`
- `'../orchestrator/app-schema.js'` → `'./employee-schema.js'`
- `'./skill-factory.js'` → `'./skill-factory.js'`
- `'../prompts/index.js'` → `'../prompts/index.js'`
- `'./types.js'` → 删除这个 import，从 `employee-schema.js` 引入
- `GenerationResult` / `OptimizationResult` / `FeishuQASkill` / `FormFallback` → 在 `employee-generator.ts` 内部定义

- [ ] **Step 3: 迁移 skill-factory.ts, form-workflow-generator.ts, workflow-doc-extractor.ts**

```bash
cp src/demo/skill-factory.ts src/orchestrator/skill-factory.ts
cp src/demo/form-workflow-generator.ts src/orchestrator/form-workflow-generator.ts
cp src/demo/workflow-doc-extractor.ts src/orchestrator/workflow-doc-extractor.ts
```

更新 import 路径（`'../demo/...'` → `'./...'` 等）。

- [ ] **Step 4: 更新 web.ts 和 index.ts 的 import**

`src/web.ts:10-12,34`:
```typescript
// OLD:
import { registerDemoRoutes } from './demo/demo-api.js';
import { DemoAgentGenerator } from './demo/agent-generator.js';
import { SkillFactory } from './demo/skill-factory.js';
import type { TraceStore } from './demo/trace-store.js';
// NEW:
import { registerEmployeeRoutes } from './orchestrator/employee-api.js';
import { EmployeeGenerator } from './orchestrator/employee-generator.js';
import { SkillFactory } from './orchestrator/skill-factory.js';
import type { TraceStore } from './orchestrator/trace-store.js';
```

`src/index.ts:37`:
```typescript
// OLD:
import { TraceStore } from './demo/trace-store.js';
// NEW:
import { TraceStore } from './orchestrator/trace-store.js';
```

- [ ] **Step 5: 编译验证**

```bash
cd happycompany && npx tsc --noEmit
```

Expected: PASS.

---

### Task A5: demo-api → employee-api (合并进 orchestrator)

**Files:**
- Create: `src/orchestrator/employee-api.ts` (from demo/demo-api.ts)
- Modify: `src/web.ts` — 更新 import + 调用
- Delete: `src/demo/demo-api.ts`

- [ ] **Step 1: 创建 employee-api.ts**

`demo-api.ts` 的核心逻辑搬过来，改：
- 所有 `/api/demo/` → `/api/employees/`
- `DemoAgent` → `EmployeeDefinition`
- `DemoAgentGenerator` → `EmployeeGenerator`（从 employee-generator 导入）
- `AgentColonyManager` → `EmployeeManager`（从 employee-colony 导入）
- `LoadedApp` / `AppDefinition` → `LoadedEmployee` / `EmployeeDefinition`
- `DemoApiDeps` → `EmployeeApiDeps`
- `registerDemoRoutes` → `registerEmployeeRoutes`
- `corpDir/{tenant}/apps/` → `corpDir/{tenant}/employees/`

- [ ] **Step 2: 更新 web.ts**

`src/web.ts:358-373`:
```typescript
// OLD:
const skillFactory = new SkillFactory(deps.corpDir);
const generator = new DemoAgentGenerator({...});
registerDemoRoutes(app, {...});

// NEW:
const skillFactory = new SkillFactory(deps.corpDir);
const generator = new EmployeeGenerator({...});
registerEmployeeRoutes(app, {...});
```

- [ ] **Step 3: 删除 demo/ 目录**

```bash
rm src/demo/demo-api.ts
rm src/demo/agent-generator.ts
rm src/demo/skill-factory.ts
rm src/demo/types.ts
rm src/demo/form-workflow-generator.ts
rm src/demo/workflow-doc-extractor.ts
rm src/demo/trace-store.ts
rmdir src/demo/
```

- [ ] **Step 4: 编译 + 测试**

```bash
cd happycompany && npx tsc --noEmit
cd happycompany && npx vitest run
```

Expected: tsc PASS + 测试大部分 PASS（部分测试文件 import 路径还未更新，会失败，在 Phase E 集中修复）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: phase A — 后端类型合并 + demo/ 删除

- 新建 employee-schema.ts，合并 AppDefinition + DemoAgent
- app-loader → employee-loader (LoadedEmployee)
- agent-colony → employee-colony (EmployeeManager)
- demo/ 下 5 个文件迁移到 orchestrator/
- demo-api → employee-api，路由 /api/demo/* → /api/employees/*
- 删除 demo/ 目录"
```

---

## Commit 2: `refactor: phase B — 存储路径 apps/ → employees/`

### Task B1: 重命名 YAML 目录 + 更新加载路径

**Files:**
- Modify: `src/orchestrator/employee-loader.ts` (最终改 employees/ 路径)
- Rename: `corp/acme/apps/` → `corp/acme/employees/`

- [ ] **Step 1: 重命名目录**

```bash
cd /workspace && mv corp/acme/apps corp/acme/employees
ls corp/acme/employees/
```

Expected: 所有 `.yaml` 文件 + `med_crm/` 子目录都在。

- [ ] **Step 2: 检查 tool-registry 是否依赖 apps/ 路径**

```bash
grep -n "apps/" src/tool-registry.ts
```

如果有硬编码路径，更新为 `employees/`。

- [ ] **Step 3: 重启 PM2 验证**

```bash
pm2 restart happycompany-dev
sleep 3
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/employees/agents
```

Expected: 200 或正常 JSON 响应。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: phase B — 存储路径 apps/ → employees/"
```

---

## Commit 3: `refactor: phase C — 前端页面合并 + API 对齐`

### Task C1: 更新前端 API 客户端类型

**Files:**
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: 替换类型定义**

把 `DemoAgent` 接口替换为 `Employee`:
```typescript
// OLD:
export interface DemoAgent {
  id: string;
  displayName: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  role: string;
  capabilities: string[];
  workspace: string;
  source: 'generated' | 'prepopulated' | 'forked';
  createdAt: number;
  hasFallbackLevel1: boolean;
  hasFallbackLevel2: boolean;
  toolCount: number;
  skillCount: number;
  fallbackLevel2?: FormFallback;
}

// NEW:
export interface Employee {
  id: string;
  displayName: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  role: string;
  capabilities: string[];
  workspace: string;
  source: 'generated' | 'prepopulated' | 'forked';
  createdAt: number;
  hasFallbackLevel1: boolean;
  hasFallbackLevel2: boolean;
  toolCount: number;
  skillCount: number;
  fallbackLevel2?: FormFallback;
}
```

把 `AppInfo` → `SkillPackage`:
```typescript
// OLD:
export interface AppInfo {
  name: string;
  currentVersion: string;
  description: string;
  versions: AppVersion[];
}
// NEW:
export interface SkillPackage {
  name: string;
  currentVersion: string;
  description: string;
  versions: SkillPackageVersion[];
}
```

- [ ] **Step 2: 更新 API 方法名**

```typescript
// OLD:
listDemoAgents: () => request<{ agents: DemoAgent[] }>('/api/demo/agents'),
generateDemoAgent: (body) => request<GenerationResult>('/api/demo/generate-agent', ...),
// NEW:
listEmployees: () => request<{ employees: Employee[] }>('/api/employees/agents'),
generateEmployee: (body) => request<GenerationResult>('/api/employees/generate-agent', ...),
```

同步更新所有 `/api/demo/*` → `/api/employees/*`，`/api/admin/apps` → `/api/admin/skill-packages`。

- [ ] **Step 3: 编译前端验证**

```bash
cd happycompany/web && npx tsc --noEmit
```

Expected: 会有其他文件引用旧类型名报错，在后续 Task 中逐文件修复。

---

### Task C2: 合并 DigitalEmployees + Build → Employees.tsx

**Files:**
- Create: `web/src/pages/Employees.tsx`
- Delete: `web/src/pages/DigitalEmployees.tsx`, `web/src/pages/Build.tsx`
- Modify: `web/src/App.tsx` (路由)
- Modify: `web/src/components/Layout.tsx` (侧边栏)

- [ ] **Step 1: 创建 Employees.tsx**

融合两个页面的功能：
- 主视图：员工卡片网格（从 DigitalEmployees 搬过来）
- Tab "新建员工"：NL 输入框 + 生成按钮（从 Build 搬过来）
- 类型从 `DemoAgent` 改为 `Employee`
- API 调用从 `api.listDemoAgents()` 改为 `api.listEmployees()`

保留的关键功能：
- 员工卡片（AgentCard）
- 生成（generateEmployee）
- 分叉（forkEmployee）
- 优化（optimizeEmployees）
- 统计概览（StatsSummary）
- 工作流构建器（FormWorkflowBuilder，可选 Tab）

- [ ] **Step 2: 更新路由 App.tsx**

```typescript
// 删除:
<Route path="apps" element={<Apps />} />
<Route path="build" element={<Build />} />
<Route path="digital-employees" element={<DigitalEmployees />} />

// 新增:
<Route path="employees" element={<Employees />} />
```

- [ ] **Step 3: 更新侧边栏 Layout.tsx**

```typescript
// OLD:
{ to: '/apps', label: '应用', short: '📦' },
{ to: '/skills', label: 'Skills', short: '🧩' },
{ to: '/build', label: 'Build', short: '🔧' },
{ to: '/digital-employees', label: '数字员工', short: '👥' },

// NEW:
{ to: '/employees', label: '数字员工', short: '👥' },
```

- [ ] **Step 4: 前端编译验证**

```bash
cd happycompany/web && npx tsc --noEmit
```

Expected: PASS.

---

### Task C3: 合并 Apps + Skills → SkillsMarketplace.tsx

**Files:**
- Create: `web/src/pages/SkillsMarketplace.tsx`
- Delete: `web/src/pages/Apps.tsx`, `web/src/pages/Skills.tsx`
- Modify: `web/src/App.tsx` (路由)
- Modify: `web/src/components/Layout.tsx` (侧边栏)

- [ ] **Step 1: 创建 SkillsMarketplace.tsx**

融合逻辑：
- 主视图：技能包列表（从 Apps 搬，publish/install/rollback）
- Tab "技能编辑"：创建/编辑 skill markdown（从 Skills 搬）
- 类型从 `AppInfo` 改为 `SkillPackage`

- [ ] **Step 2: 更新路由 + 侧边栏**

```typescript
// App.tsx 新增:
<Route path="skills-marketplace" element={<SkillsMarketplace />} />

// Layout.tsx 新增:
{ to: '/skills-marketplace', label: '技能市场', short: '📦' },
```

- [ ] **Step 3: 删除旧页面文件**

```bash
rm web/src/pages/Apps.tsx
rm web/src/pages/Skills.tsx
rm web/src/pages/Build.tsx
rm web/src/pages/DigitalEmployees.tsx
rm -r web/src/pages/apps/
```

- [ ] **Step 4: 前端 build 验证**

```bash
cd happycompany/web && npm run build
```

Expected: PASS.

- [ ] **Step 5: 全量编译 + 测试**

```bash
cd happycompany && npx tsc --noEmit
cd happycompany && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: phase C — 前端页面合并 + API 对齐

- DigitalEmployees + Build → Employees.tsx
- Apps + Skills → SkillsMarketplace.tsx
- DemoAgent/AppInfo → Employee/SkillPackage
- /api/demo/* → /api/employees/*
- 更新路由 + 侧边栏"
```

---

## Commit 4: `feat: phase D — 企业入驻引导`

### Task D1: 后端 API — 创建企业 + 创建员工

**Files:**
- Create: `src/routes/admin-tenants.ts`
- Modify: `src/web.ts` (注册路由)

- [ ] **Step 1: 创建 admin-tenants.ts**

```typescript
import type { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';

export function registerTenantRoutes(
  app: Hono,
  deps: { corpDir: string; employeeLoader: EmployeeLoader; employeeGenerator: EmployeeGenerator },
): void {

  // POST /api/tenants — 创建企业
  app.post('/api/tenants', async (c) => {
    const body = await c.req.json() as {
      name: string;
      displayName: string;
      description?: string;
    };
    if (!body.name || !body.displayName) {
      return c.json({ error: 'name and displayName required' }, 400);
    }

    const tenantDir = path.join(deps.corpDir, body.name);
    if (fs.existsSync(tenantDir)) {
      return c.json({ error: 'Tenant already exists' }, 409);
    }

    fs.mkdirSync(path.join(tenantDir, 'employees'), { recursive: true });

    const appJson = {
      displayName: body.displayName,
      description: body.description || '',
    };
    fs.writeFileSync(path.join(tenantDir, 'app.json'), JSON.stringify(appJson, null, 2));

    const rolesJson = {
      roles: {
        admin: { displayName: '管理员', tools: '*' },
        member: { displayName: '员工', tools: [] },
        readonly: { displayName: '只读', tools: [] },
      },
      users: { '*': 'member' },
    };
    fs.writeFileSync(path.join(tenantDir, 'roles.json'), JSON.stringify(rolesJson, null, 2));

    return c.json({ tenant: body.name, displayName: body.displayName });
  });

  // POST /api/employees/generate — NL 生成员工
  app.post('/api/employees/generate', async (c) => {
    const body = await c.req.json() as {
      tenant: string;
      description: string;
    };
    if (!body.tenant || !body.description) {
      return c.json({ error: 'tenant and description required' }, 400);
    }

    const result = await deps.employeeGenerator.generate(body.description, body.tenant);
    deps.employeeLoader.reload([]); // trigger reload

    return c.json(result);
  });
}
```

- [ ] **Step 2: 在 web.ts 注册路由**

```typescript
import { registerTenantRoutes } from './routes/admin-tenants.js';

// 在 startWebServer 函数内部:
registerTenantRoutes(app, {
  corpDir: deps.corpDir,
  employeeLoader: deps.employeeLoader,
  employeeGenerator: generator,
});
```

需要确保 `deps` 里有 `employeeLoader` 和 `employeeGenerator` 字段。检查 `web.ts` 的 `WebDeps` interface 是否需要扩展。

- [ ] **Step 3: 编译验证**

```bash
cd happycompany && npx tsc --noEmit
```

---

### Task D2: 前端引导页

**Files:**
- Create: `web/src/pages/Onboarding.tsx`
- Modify: `web/src/App.tsx` (路由)

- [ ] **Step 1: 创建 Onboarding.tsx**

三步向导：
```tsx
// Step 1: 企业信息
<form>
  <input name="name" placeholder="企业标识 (英文)" />
  <input name="displayName" placeholder="企业名称" />
  <input name="description" placeholder="企业描述" />
  <button>下一步</button>
</form>

// Step 2: 角色定义（可编辑的默认模板）
<pre contentEditable>{JSON.stringify(rolesTemplate, null, 2)}</pre>

// Step 3: 首个数字员工
<input name="employeeDesc" placeholder="描述第一个数字员工，例如：负责销售跟进的助手，能查CRM、发合同" />
<button>创建企业 + 生成员工</button>
```

完成后调用 `POST /api/tenants` → `POST /api/employees/generate` → 跳转 `/employees`。

- [ ] **Step 2: 路由 + 入口**

```typescript
// App.tsx:
<Route path="onboarding" element={<Onboarding />} />

// Layout.tsx 侧边栏底部:
{ to: '/onboarding', label: '+ 新建企业', short: '🏢' },
```

- [ ] **Step 3: 前端 build**

```bash
cd happycompany/web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: phase D — 企业入驻引导

- POST /api/tenants 创建企业目录 + 默认角色
- POST /api/employees/generate NL 生成员工
- Onboarding.tsx 三步引导页"
```

---

## Commit 5: `test: phase E — 测试修复 + 全量回归`

### Task E1: 批量修复测试文件

**Files (15 个):**
```
tests/demo-api.test.ts                          — API 路由 /api/demo/* → /api/employees/*
tests/env-guard.test.ts                         — demo 相关 import
tests/orchestrator/app-schema.test.ts           — AppDefinition → EmployeeDefinition
tests/orchestrator/app-schema-event.test.ts     — 同上
tests/orchestrator/app-loader.test.ts           — AppDefinitionLoader → EmployeeLoader
tests/orchestrator/app-e2e.test.ts              — e2e 类型引用
tests/orchestrator/agent-colony.test.ts         — AgentColonyManager → EmployeeManager
tests/orchestrator/event-bridge.test.ts         — import 路径
tests/orchestrator/platform-admin-app.test.ts   — 同上
tests/integration-colony.test.ts                — 同上
tests/integration-colony-reload.test.ts         — 同上
tests/integration-event-bridge.test.ts          — 同上
tests/integration-platform-admin.test.ts        — 同上
tests/integration-scheduler-event-pipeline.test.ts — 同上
tests/business-api.test.ts                      — 同上
tests/phase5-integration.test.ts                — 同上
```

- [ ] **Step 1: 正则批量替换 import 路径**

```bash
cd happycompany

# 类型名替换
find tests/ -name "*.ts" -exec sed -i '' 's/AppDefinition/EmployeeDefinition/g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's/appDefinitionSchema/employeeDefinitionSchema/g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's/AppDefinitionLoader/EmployeeLoader/g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's/LoadedApp/LoadedEmployee/g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's/AgentColonyManager/EmployeeManager/g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's/ColonyAgent/RegisteredEmployee/g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's/DemoAgent/Employee/g' {} +

# import 路径替换
find tests/ -name "*.ts" -exec sed -i '' 's|./app-loader|./employee-loader|g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's|./app-schema|./employee-schema|g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's|./agent-colony|./employee-colony|g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's|\.\./demo/trace-store|../orchestrator/trace-store|g' {} +
find tests/ -name "*.ts" -exec sed -i '' 's|/api/demo/|/api/employees/|g' {} +
```

- [ ] **Step 2: 编译验证**

```bash
cd happycompany && npx tsc --noEmit
```

Expected: 零 TS 错误。

- [ ] **Step 3: 全量测试**

```bash
cd happycompany && npx vitest run
```

Expected: 931 tests (baseline)，可能有几个需要手动修。逐个看失败原因修复。

- [ ] **Step 4: 前端 build + 测试**

```bash
cd happycompany/web && npm run build
cd happycompany && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: phase E — 测试修复 + 全量回归

- 15 个测试文件 import/类型名/API 路径对齐
- 全量 vitest run 通过"
```

---

## 验收检查清单

全部 5 个 commit 完成后：

- [ ] `npx tsc --noEmit` — 零 TS 错误
- [ ] `cd web && npm run build` — 前端零构建错误
- [ ] `npx vitest run` — 931 测试通过
- [ ] `pm2 restart happycompany-dev && sleep 3 && curl -s http://localhost:3100/` — HTTP 200
- [ ] `curl -s http://localhost:3100/api/employees/agents` — 返回员工列表 JSON
- [ ] `ls src/demo/` — 目录不存在或为空
- [ ] `grep -r "DemoAgent\|AppDefinition\|LoadedApp\|AgentColonyManager" src/ --include="*.ts"` — 零结果（除了 compat alias）
- [ ] `grep -r "apps/" src/ --include="*.ts" | grep -v node_modules` — 只有向后兼容回退路径
