# User Bootstrap Test Plan

**更新**: 2026-05-24 — Workdir 导入补齐员工拆分建议、依赖校验、确认后生成员工 YAML 的测试覆盖；模板入口和 PeopleBinding 文案测试已同步当前实现。

**改动总览**: 三页引导流程（ModelConfig → EmployeeNetwork → PeopleBinding）+ Onboarding 引导壳 + 行业模板 + Workdir 导入 + 入口路由。

**Spec**: [docs/superpowers/specs/2026-05-22-user-bootstrap-design.md](../superpowers/specs/2026-05-22-user-bootstrap-design.md)

**验证命令**:
```bash
npx vitest run                                    # 后端单元/集成
cd web && npx vitest run                          # 前端单元
cd web && npx playwright test                     # E2E
npx tsc --noEmit                                  # 类型检查
cd web && npx tsc --noEmit && npm run build       # 前端构建
```

---

## 现有测试基线

### 后端（有覆盖）

| 文件 | 行数 | 覆盖内容 |
|------|------|----------|
| `tests/entry-router.test.ts` | 167 | slash 解析、路由选择、selector 构建 |
| `tests/workdir-scanner.test.ts` | 137 | SKILL.md 扫描、bin 扫描、依赖提取、path traversal |
| `tests/skill-validator.test.ts` | 229 | 存在性、exec、shebang、runtime deps |
| `tests/template-loader.test.ts` | 166 | list/load/instantiate |
| `tests/enterprise-people.test.ts` | 142 | 新 schema (entryEmployee/routingMode/visibleEmployees) |
| `tests/enterprise-people-routes.test.ts` | 106 | people API 路由 |
| `tests/skills.test.ts` | 278 | frontmatter 解析、parseDependencies、hasWriteOps |
| `tests/api-integration/setup.test.ts` | — | setup API 集成 |

### 前端（需补）

| 文件 | 行数 | 覆盖内容 |
|------|------|----------|
| `web/src/pages/ModelConfig.test.tsx` | 259 | LLM 配置页面 |
| `web/src/pages/PeopleBinding.test.tsx` | 25 | **空壳** — 只有 mock，无断言 |
| `web/src/components/Layout.test.tsx` | 93 | 基本渲染 |

### 缺失

| 缺失 | 说明 |
|------|------|
| `EmployeeNetwork.test.tsx` | 不存在 |
| `OnboardingBanner.test.tsx` | 不存在 |
| `employee-network` E2E | 不存在 |
| `people-binding` E2E | 不存在 |
| `bootstrap-flow` E2E | 不存在 |

---

## 一、单元测试

### 1.1 后端已有 — 需补充的用例

#### `tests/entry-router.test.ts`

| 用例 | 输入 | 预期 |
|------|------|------|
| pipeline 串联 | 模拟 bound 用户发普通消息 | 走 resolveEnterpriseEntryAgent → 返回 entryEmployee |
| pipeline slash | 模拟用户发 `/list` | 走 parseSlashCommand → 返回团队列表 |
| pipeline selector | 模拟无绑定用户发消息 | 走 buildSelectorResponse → 返回选择器文本 |
| routingMode bound | routingMode='bound', entryEmployee='sales' | 直接返回 'sales' |
| routingMode selector | routingMode='selector' | 返回 selector 文本 |
| visibleEmployees 过滤 | visibleEmployees=['a','b'], slash `/{name}` 匹配范围外 | 返回 null/not-found |
| findByHumanUserId 集成 | 查询 EnterprisePeopleStore | 正确返回 entryEmployee |

**新增约 5-7 个用例。**

#### `tests/api-integration/setup.test.ts`

| 用例 | 输入 | 预期 |
|------|------|------|
| 三步全未完成 | 无 API key、无 employee、无 people | `{ configured: false, steps: { modelConfigured: false, employeeNetworkReady: false, peopleBound: false } }` |
| 仅模型已配 | 有 API key | `steps.modelConfigured: true, employeeNetworkReady: false` |
| 模型+员工已配 | 有 key + 有 employee YAML | `steps.employeeNetworkReady: true` |
| 三步全完成 | key + employee + people entryEmployee | `configured: true, steps 全 true` |

**新增约 4 个用例。**

### 1.2 前端需新增/补全

#### `web/src/pages/PeopleBinding.test.tsx`（从 25 行空壳 → 补全）

| 用例 | 输入 | 预期 |
|------|------|------|
| 渲染人员列表 | mock people 数据 | 显示人员卡片 |
| 同步按钮 | 点击同步 | 调用 `api.syncEnterprisePeople()` |
| 绑定入口员工 | 选择 entryEmployee | 调用 `api.bindEnterprisePerson()` |
| 切换 routingMode | bound → selector | 更新显示 |
| 可见员工勾选 | 勾选 employee | visibleEmployees 更新 |
| 空状态 | 无 people 数据 | 显示空状态提示 |

**约 6-8 个用例，目标 80-120 行。**

#### `web/src/pages/EmployeeNetwork.test.tsx`（新建）

| 用例 | 输入 | 预期 |
|------|------|------|
| 渲染双入口卡片 | 初始状态 | 显示"从模板"和"从 Workdir"两个选项 |
| 选择模板路径 | 点击模板卡片 | 进入模板选择视图 |
| 模板列表 | mock templates API | 显示模板网格 |
| 预览模板 | 选择一个模板 | 显示员工预览列表 |
| 实例化模板 | 确认创建 | 调用 `api.instantiateTemplate()` |
| 选择 Workdir 路径 | 点击 Workdir 卡片 | 进入路径输入视图 |
| 扫描 Workdir | 输入路径 + 扫描 | 调用 `api.scanWorkdir()`，显示 skill 列表 |
| Workdir 员工拆分建议 | 扫描返回 skill | 显示可编辑员工名称、角色 ID、说明 |
| Workdir 依赖校验 | 点击校验所选技能 | 调用 `api.validateWorkdirSkill()` 并展示通过/错误/警告 |
| Workdir 校验失败阻断 | validator 返回 error | 不调用 `api.importEmployees()`，显示失败提示 |
| Workdir 确认导入 | 填租户名 + 导入 | `api.importEmployees()` 携带 `employeeDrafts` |
| IM 渠道配置 | 填写钉钉凭证 | 渠道配置保存 |
| 完成状态检测 | 已有 employee + channel | 显示完成徽章 |

**约 8-10 个用例，目标 120-180 行。**

#### `web/src/components/OnboardingBanner.test.tsx`（新建）

| 用例 | 输入 | 预期 |
|------|------|------|
| 模型未配 | `modelConfigured: false` | 显示"请先配置模型"，跳转 /model-config |
| 仅模型已配 | `modelConfigured: true, employeeNetworkReady: false` | 显示"创建你的数字员工团队"，跳转 /employee-network |
| 仅差绑定 | model + employee ready, peopleBound: false | 显示"配置人员绑定"，跳转 /people-binding |
| 全部完成 | 三步 true | 不渲染 banner |
| dismiss | 点击关闭 | 存 localStorage，不再显示 |
| isFullHeight | 传入 isFullHeight=true | 不渲染 banner |

**约 6 个用例，目标 60-90 行。**

#### `web/src/pages/ModelConfig.test.tsx`（已有 259 行，需验证 B1 修复后）

| 用例 | 验证点 |
|------|--------|
| bootstrap status 调用 | 确认调用 `/api/setup/status`（非 bootstrap-status） |
| 已配置状态显示 | 返回 modelConfigured: true 时显示"已配置"徽章 |
| 保存后跳转 | 保存成功后跳转 /employee-network |

**需修改已有 mock 的 API 路径，新增约 2 个用例。**

---

## 二、集成测试

### 2.1 后端 API 集成

#### `tests/api-integration/setup.test.ts` — 三步状态

已在 1.1 列出。关键是验证 `/api/setup/status` 返回结构正确。

#### `tests/enterprise-people-routes.test.ts` — 新 schema

| 用例 | 输入 | 预期 |
|------|------|------|
| bind with entryEmployee | POST bind { entryEmployee, routingMode, visibleEmployees } | people.json 更新 |
| read bound person | GET people | 返回含 entryEmployee/routingMode/visibleEmployees |
| unbind clears fields | POST unbind | entryEmployee/routingMode/visibleEmployees 都清空 |
| migration from old format | people.json 含 assistantId/role | 自动迁移为新格式 |

**新增约 3-4 个用例。**

#### `tests/orchestrator/employee-api-import.test.ts` — Workdir employee drafts

| 用例 | 输入 | 预期 |
|------|------|------|
| tenant-shaped 目录导入 | sourcePath 指向含 employees YAML 的租户目录 | 复制 YAML 到目标租户并注册 EmployeeManager |
| 非租户目录拒绝 | sourcePath 指向普通空目录且无 employeeDrafts | 400，提示不是 corp tenant directory |
| Workdir draft 导入 | 普通 workdir + `.claude/skills/*/SKILL.md` + `employeeDrafts` | 生成目标租户 employee YAML，skills 绑定到员工，注册 EmployeeManager |

---

## 三、E2E 测试

### 3.1 引导流程（新建 `web/e2e/story-bootstrap/`）

#### `story-bootstrap-flow.spec.ts`

| 步骤 | 操作 | 预期 |
|------|------|------|
| 首次访问 | 访问 `/` | 重定向到 /model-config 或 banner 提示配置模型 |
| 配置模型 | 填写 API Key → 保存 | 成功，跳转 /employee-network |
| 检查 banner | 模型已配，员工未配 | banner 显示"创建你的数字员工团队" |
| 选择模板 | 选择医疗器械模板 → 预览 → 创建 | 员工创建成功 |
| 配置渠道 | 填写钉钉凭证 → 保存 | 渠道配置完成 |
| 绑定人员 | 跳转 /people-binding → 同步 → 绑定入口员工 | 绑定成功 |
| 完成引导 | 三步完成 | banner 消失 |

### 3.2 模板路径（`web/e2e/story-bootstrap/`）

#### `story-template-path.spec.ts`

| 步骤 | 操作 | 预期 |
|------|------|------|
| 浏览模板 | 访问 /employee-network → 选模板 | 显示可用行业模板 |
| 预览员工 | 选择模板 → 预览 | 显示推荐员工列表 |
| 实例化 | 确认创建 | 租户目录下生成 employee YAML + roles.json |

### 3.3 Workdir 路径

#### `story-workdir-path.spec.ts`

| 步骤 | 操作 | 预期 |
|------|------|------|
| 输入路径 | 访问 /employee-network → 选 Workdir → 输入路径 | 扫描结果展示 |
| 查看 skill | 扫描完成 | 显示 skill 列表、bin 入口、依赖信息 |
| 拆分建议 | 扫描完成 | 显示员工拆分建议，可编辑员工名称、角色 ID 和说明 |
| 依赖校验 | 点击校验所选技能 | 显示校验通过/错误/警告 |
| 确认导入 | 填租户名 → 选择 skill → 确认 | 请求携带 employeeDrafts 并创建员工 |

---

## 四、类型检查

| 检查 | 预期 |
|------|------|
| `EnterprisePerson` 含 `entryEmployee?: string` | 编译通过 |
| `EnterprisePerson` 含 `routingMode?: 'bound' \| 'selector'` | 编译通过 |
| `EnterprisePerson` 含 `visibleEmployees?: string[]` | 编译通过 |
| PeopleBinding.tsx 无 `as unknown as` 类型强转 | 编译通过 |

---

## 五、测试修改/删除

### 需修改

| 文件 | 原因 |
|------|------|
| `web/src/pages/Setup.test.tsx` (270 行) | Setup.tsx 已改为 ModelConfig.tsx，测试应跟随或标注废弃 |
| `web/src/pages/ModelConfig.test.tsx` | 修复 B1 后需更新 API mock 路径 |
| `web/src/components/Layout.test.tsx` | 加入 OnboardingBanner 渲染断言 |

### 需删除

| 文件 | 原因 |
|------|------|
| `web/src/App.tsx.bak` | 临时备份文件，不应提交 |

---

## 六、覆盖范围 vs Spec 映射

| Spec 章节 | 单元 | 集成 | E2E |
|-----------|------|------|-----|
| ① ModelConfig | ✅ 已有 | ✅ setup.test | ✅ bootstrap-flow |
| ② EmployeeNetwork (模板) | ✅ 新建 | ✅ template-loader | ✅ template-path |
| ② EmployeeNetwork (Workdir) | ✅ 已有 scanner/validator | 需补 workdir routes | ✅ workdir-path |
| ③ PeopleBinding | ✅ 补全 | ✅ people-routes | ✅ bootstrap-flow |
| Onboarding 壳 | ✅ 新建 | ✅ setup.test 三步 | ✅ bootstrap-flow |
| 行业模板体系 | ✅ 已有 | — | — |
| 入口路由 | ✅ 需补 pipeline | — | — |
| 两层路由 §协作 | 🔜 后续迭代 | 🔜 | 🔜 |
| 导出/模板保存 | 🔜 后续迭代 | 🔜 | 🔜 |
| workdir sync | 🔜 后续迭代 | 🔜 | 🔜 |

### 2026-05-24 验证记录

| 命令 | 结果 |
|------|------|
| `env VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/orchestrator/employee-api-import.test.ts tests/workdir-scanner.test.ts tests/skill-validator.test.ts tests/template-loader.test.ts tests/entry-router.test.ts tests/enterprise-people.test.ts tests/enterprise-people-routes.test.ts tests/tool-schemas.test.ts tests/skill-tool-builder.test.ts tests/collaborate.test.ts tests/tenant-export.test.ts tests/tenant-template-save.test.ts` | ✅ 12 文件，102 测试通过 |
| `npm run typecheck` | ✅ 后端 TypeScript 通过 |
| `cd web && npm run test -- --run` | ✅ 16 文件，138 测试通过 |
| `cd web && npm run build` | ✅ TypeScript build + Vite build 通过；仅 chunk size warning |
| `cd web && npx playwright test e2e/story-bootstrap` | ✅ 9 E2E 通过 |
| `cd web && npx playwright test` | ✅ 配置内默认 E2E 23 通过 |
| `npx vitest run tests/orchestrator/employee-api-import.test.ts ...` | ⚠️ 未进入需求测试；Vitest globalSetup 等待 3100 超时，需用 `VITEST_SKIP_GLOBAL_SETUP=1` 跑这组纯单元/集成测试 |
| `cd web && npm run test -- --run src/pages/PeopleBinding.test.tsx src/pages/EmployeeNetwork.test.tsx` | ✅ 2 文件，24 测试通过；覆盖租户透传、切换租户、绑定入口员工、selector 模式和解除绑定 |
| `cd web && npm run test -- --run` | ✅ 16 文件，143 测试通过 |
| `npm run typecheck` | ✅ 后端/前端引用的 TypeScript 检查通过 |
| `cd web && npx playwright test e2e/story-bootstrap` | ✅ 9 E2E 通过；人员绑定步骤已改为真实点击侧边栏并保存绑定 |
| `cd web && npx playwright test` | ✅ 配置内默认 E2E 23 通过 |

---

## 实施顺序

1. **P0 修 bug** — B1 (API 端点) + B2 (raw fetch) + B3 (类型)
2. **补单元测试** — OnboardingBanner → PeopleBinding → EmployeeNetwork → entry-router pipeline
3. **补集成测试** — setup.test 三步状态
4. **提交 Wave 2**
5. **E2E** — bootstrap-flow + template-path
6. **Verify** — 全量测试 + spec 一致性检查
