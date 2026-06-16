# 企业员工与入口路由收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“单个企业钉钉 Bot + 内部员工/助手分发路由”做成可配置、可测试、可在 Web 管理台使用的闭环。

**Architecture:** 企业入口 Bot 只负责接收钉钉消息，后端根据 tenant、DingTalk userId、人类员工绑定、数字员工 humanUserId、企业调度员 fallback 做路由。Web 侧把原来的 “Bot 页面”改成“入口路由”，新增“企业员工”页用于同步钉钉通讯录、给真人分配角色和个人助手。

**Tech Stack:** Node.js + TypeScript + Hono + Zod + React + Vite + Zustand + Vitest + Playwright/browser smoke

---

## Current Checkpoint

当前分支：`main`。

当前工作区是 dirty working tree：有一批已修改/新增但未提交的文件。这是预期状态，不要随手 `git checkout --` 或 `git reset --hard`。

已完成并合入的上一轮提交：

```bash
801ef7f feat(orchestrator): unify employee workflow workbench
```

当前未提交的主要改动：

- `src/enterprise-routing.ts`：企业入口 Bot 路由逻辑。
- `src/types.ts` / `src/config.ts` / `src/index.ts`：`BotConfig` 增加 `tenant`、`routingMode`、`entryEmployeeId`，入口消息调用 `resolveEnterpriseEntryAgent(...)`。
- `src/orchestrator/employee-colony.ts`：增加 `findByHumanUserId(tenantName, userId)`。
- `src/enterprise-people.ts`：新增 `EnterprisePeopleStore`，持久化 `corp/{tenant}/people.json`。
- `src/routes/enterprise-people.ts`：新增企业员工 API。
- `src/web.ts`：注册企业员工 API。
- `web/src/pages/EnterprisePeople.tsx`：新增企业员工管理页。
- `web/src/pages/Bots.tsx`：语义调整为“入口路由”。
- `web/src/components/Layout.tsx` / `web/src/App.tsx`：新增 `/people`，新增 `/entry-routing`。
- `tests/enterprise-people*.test.ts`、`tests/enterprise-bot-routing.test.ts`：新增/扩展测试。

当前红灯：

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/enterprise-people-routes.test.ts
```

失败点：`binds a person to a role and assistant` 期望绑定员工后创建/更新 `corp/acme/roles.json`，当前实现只更新 `people.json`，还没有写 `roles.json`。

不要输出或写入用户提供过的 DingTalk secret / GLM token。需要配置时只使用环境变量或本地 `config.json`，文档中写占位名。

---

## File Map

- Modify: `src/orchestrator/employee-org.ts`
  - 负责员工角色模板、角色定义、`roles.json` 用户绑定。
- Modify: `src/routes/enterprise-people.ts`
  - 在企业员工绑定 API 中同步更新 `roles.json`。
- Modify: `src/enterprise-people.ts`
  - 如有必要，补充绑定行为或导出类型；保持存储职责简单。
- Modify: `tests/enterprise-people-routes.test.ts`
  - 当前已有红灯，不要删；实现后确认变绿。
- Modify: `tests/enterprise-people.test.ts`
  - 补充存储层行为时使用。
- Modify: `web/src/pages/EnterprisePeople.tsx`
  - 优化企业员工页交互和视觉。
- Modify: `web/src/pages/Bots.tsx`
  - 保持“入口路由”语义，避免继续叫 Bot 管理。
- Modify: `web/src/components/Layout.tsx`
  - 导航保持“企业员工”“入口路由”。
- Modify: `docs/superpowers/specs/2026-05-14-product-architecture-v2.md`
  - 更新产品架构语义：Bot 是入口路由，不是员工本体。

---

## Task 1: Make Role Binding Persist To roles.json

**Files:**
- Modify: `src/orchestrator/employee-org.ts`
- Modify: `src/routes/enterprise-people.ts`
- Test: `tests/enterprise-people-routes.test.ts`

- [ ] **Step 1: Confirm the existing red test**

Run:

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/enterprise-people-routes.test.ts
```

Expected: FAIL in `binds a person to a role and assistant`, because `corp/acme/roles.json` is missing after `POST /api/enterprise-people/u1/bind`.

- [ ] **Step 2: Update `bindEmployeeUser` so missing roles.json is initialized**

In `src/orchestrator/employee-org.ts`, import the schema:

```typescript
import { rolesJsonSchema, type RolesJson } from '../tool-schemas.js';
```

Add defaults near `bindEmployeeUser`:

```typescript
const DEFAULT_ROLE_DEFINITIONS: RolesJson['roles'] = {
  admin: { displayName: '管理员', tools: '*' },
  sales: { displayName: '销售', tools: [] },
  finance: { displayName: '财务', tools: [] },
  maintenance: { displayName: '维保', tools: [] },
  hr: { displayName: '人事', tools: [] },
  member: { displayName: '员工', tools: [] },
};

function readOrCreateRolesJson(rolesPath: string): RolesJson {
  if (!fs.existsSync(rolesPath)) {
    return { roles: DEFAULT_ROLE_DEFINITIONS, users: {} };
  }

  const parsed = rolesJsonSchema.safeParse(JSON.parse(fs.readFileSync(rolesPath, 'utf-8')));
  if (!parsed.success) {
    throw new Error(`Invalid roles.json at ${rolesPath}: ${parsed.error.message}`);
  }

  return {
    roles: { ...DEFAULT_ROLE_DEFINITIONS, ...parsed.data.roles },
    users: parsed.data.users ?? {},
  };
}
```

Replace `bindEmployeeUser(...)` body with:

```typescript
export function bindEmployeeUser(
  corpDir: string,
  tenant: string,
  userId: string | undefined,
  role: string,
): boolean {
  if (!userId) return false;

  const rolesPath = path.join(corpDir, tenant, 'roles.json');
  fs.mkdirSync(path.dirname(rolesPath), { recursive: true });

  const rolesJson = readOrCreateRolesJson(rolesPath);
  rolesJson.users = rolesJson.users ?? {};
  rolesJson.users[userId] = role;

  fs.writeFileSync(rolesPath, JSON.stringify(rolesJson, null, 2), 'utf-8');
  return true;
}
```

- [ ] **Step 3: Call `bindEmployeeUser` from enterprise people bind route**

In `src/routes/enterprise-people.ts`, add:

```typescript
import { bindEmployeeUser } from '../orchestrator/employee-org.js';
```

Inside `POST /api/enterprise-people/:userId/bind`, after `if (!person) ...`, add:

```typescript
if (person.role) {
  bindEmployeeUser(deps.corpDir, tenant, userId, person.role);
}
```

- [ ] **Step 4: Verify route test passes**

Run:

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/enterprise-people-routes.test.ts
```

Expected: PASS, including `roles.users.u1 === 'sales'`.

---

## Task 2: Keep Enterprise Entry Routing Behavior Covered

**Files:**
- Modify only if tests reveal a gap: `src/enterprise-routing.ts`
- Modify only if tests reveal a gap: `src/orchestrator/employee-colony.ts`
- Test: `tests/enterprise-bot-routing.test.ts`

- [ ] **Step 1: Run focused routing tests**

Run:

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/enterprise-bot-routing.test.ts
```

Expected: PASS.

- [ ] **Step 2: If failing, preserve this route priority**

Expected behavior:

```text
1. If incoming DingTalk userId matches an employee humanUserId in the same tenant, route to that employee.
2. Else if BotConfig has entryEmployeeId, route to that enterprise dispatcher.
3. Else keep existing/default routing behavior.
```

Do not introduce one bot per employee as the default architecture. The product direction is one enterprise entry bot with internal route dispatch.

---

## Task 3: Tighten Enterprise People Page UX

**Files:**
- Modify: `web/src/pages/EnterprisePeople.tsx`
- Modify if needed: `web/src/styles/global.css`
- Modify if needed: `web/src/styles/tokens.css`
- Test: `web/src/components/Layout.test.tsx`

- [ ] **Step 1: Keep page as an operations table, not a landing page**

The first screen should show:

```text
企业员工
tenant switch/input
同步钉钉 button
活跃员工 / 已绑定助手 / 未绑定 metrics
员工表格
```

Avoid nested cards. Use one table surface and compact metric blocks.

- [ ] **Step 2: Improve binding controls**

Keep two select controls per row:

```text
角色: 未分配 / sales / finance / maintenance / hr / admin / member
个人助手: 走企业调度员 / role-filtered employee list
```

When role changes, call `api.bindEnterprisePerson(...)` and preserve current assistantId.

When assistant changes, call `api.bindEnterprisePerson(...)` and preserve current role.

- [ ] **Step 3: Run layout/nav test**

Run:

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run web/src/components/Layout.test.tsx
```

Expected: PASS and navigation contains `企业员工` and `入口路由`.

---

## Task 4: Rename Product Semantics In Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-05-14-product-architecture-v2.md`

- [ ] **Step 1: Search old naming**

Run:

```bash
rg "Bot|机器人|入口路由|企业员工|数字员工" docs/superpowers/specs/2026-05-14-product-architecture-v2.md
```

- [ ] **Step 2: Apply the product distinction**

Use this wording:

```text
数字员工：可被路由到的工作主体，有 role、tools、skills、workspace、humanUserId。
企业员工：真实组织成员，来自钉钉通讯录，有 userId、部门、角色、个人助手绑定。
入口路由：企业对外/对内接入点，通常是一个钉钉 Bot；它不是每个员工一个 Bot，而是根据 userId 与绑定关系分发到个人助手或企业调度员。
企业调度员：当真人没有个人助手绑定，或问题需要跨角色协同时的 fallback employee。
```

- [ ] **Step 3: Do not document secrets**

If mentioning GLM or DingTalk config, use:

```text
GLM_API_KEY=<redacted>
DINGTALK_CLIENT_ID=<redacted>
DINGTALK_CLIENT_SECRET=<redacted>
```

---

## Task 5: Focused Backend Verification

**Files:**
- No code changes unless a test fails.

- [ ] **Step 1: Run focused enterprise tests**

Run:

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/enterprise-people.test.ts tests/enterprise-people-routes.test.ts tests/enterprise-bot-routing.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run related config/bot tests**

Run:

```bash
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/config.test.ts tests/bot.test.ts
```

Expected: PASS. If unrelated legacy tests fail inside these files, record exact failing test names and fix only if caused by this work.

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

---

## Task 6: Frontend Build And Browser Smoke

**Files:**
- No code changes unless browser smoke reveals a frontend bug.

- [ ] **Step 1: Build frontend**

Run:

```bash
cd web && npm run build
```

Expected: PASS.

- [ ] **Step 2: Test dev frontend on configured port**

If no dev server is running:

```bash
cd web && npm run dev
```

Use Browser/Playwright to open:

```text
http://localhost:8888/people
http://localhost:8888/entry-routing
http://localhost:8888/chat
```

Expected:

```text
/people renders without React crash, shows sync button and table/empty state.
/entry-routing renders without React crash, shows enterprise entry routing semantics.
/chat can send at least two messages without UI crash.
```

- [ ] **Step 3: Production smoke through backend if backend is running**

After frontend build, restart backend if needed because backend serves `web/dist`.

Open:

```text
http://localhost:3100/people
http://localhost:3100/entry-routing
http://localhost:3100/chat
```

Expected: same as dev smoke.

---

## Task 7: Full Test Sweep Before Commit

**Files:**
- No code changes unless tests fail because of this work.

- [ ] **Step 1: Run project baseline**

Run from repo root:

```bash
npx vitest run
```

Expected: PASS. If legacy/sandbox failures appear, capture exact failing files and distinguish:

```text
caused by this work
pre-existing or environment-specific
```

- [ ] **Step 2: Re-run final required checks**

Run:

```bash
npx tsc --noEmit
cd web && npm run build
```

Expected: both PASS.

---

## Task 8: Commit And Main Hygiene

**Files:**
- Git only.

- [ ] **Step 1: Review diff**

Run:

```bash
git status --short
git diff --stat
git diff -- src/orchestrator/employee-org.ts src/routes/enterprise-people.ts src/enterprise-people.ts
```

Expected: only intended enterprise people/routing/frontend/doc changes.

- [ ] **Step 2: Commit from main**

If still on `main` and all verification is done:

```bash
git add src web tests docs/superpowers/plans/2026-05-16-enterprise-people-entry-routing.md docs/superpowers/specs/2026-05-14-product-architecture-v2.md
git commit -m "feat(orchestrator): add enterprise people entry routing"
```

Expected: commit succeeds on `main`.

- [ ] **Step 3: If work happened on another branch, merge back**

Only if not already on `main`:

```bash
git checkout main
git merge <feature-branch>
```

Expected: merge succeeds, then rerun:

```bash
npx tsc --noEmit
cd web && npm run build
```

---

## Recovery Notes

If a future agent resumes here, start with:

```bash
git status --short
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/enterprise-people-routes.test.ts
```

Then continue at Task 1. The first expected fix is to make role binding write `roles.json`.

Do not re-run DWS login unless auth is missing. Last known DWS state was authenticated for the DingTalk corp, and contact scopes had been granted for listing root department members and fetching users.
