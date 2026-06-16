# Agent Builder Test Plan

**日期**: 2026-05-31
**状态**: Verified
**关联需求**: [Agent Builder Requirements](./2026-05-31-agent-builder-requirements.md)
**交互设计**: [Agent Builder Interaction Design](./2026-05-31-agent-builder-interaction-design.md)

## 改动总览

新增 Agent Builder：把自然语言、模板、fork、手动填写统一归一为 `AgentDraft`，经过结构化校验和 harness 测试后发布为正式数字员工。

## 测试策略

| 层级 | 目标 |
| --- | --- |
| 单元测试 | 覆盖 draft schema、id 规范化、引用校验、权限校验、workspace 安全校验 |
| API 测试 | 覆盖 draft 创建、读取、更新、validate、test、publish |
| 集成测试 | 覆盖 publish 后员工 YAML 写入、workspace 初始化、EmployeeManager 注册 |
| Harness 测试 | 覆盖新员工发布前的 fake case 生成和运行 |
| Web 单测 | 覆盖 `/agent-builder` 页面关键交互、表单编辑、校验结果、按钮状态 |
| Playwright E2E | 覆盖从自然语言创建 draft 到发布的浏览器主流程 |

## Sandbox 测试项目

Agent Builder 的测试必须使用专门的 sandbox corp fixture，不读写真实企业数据。fixture 建议放在：

```text
tests/fixtures/agent-builder/sandbox-corp/
  templates/
  builder-demo/
    app.json
    roles.json
    people.json
    apps/
      med_crm/
        tools.json
    employees/
      sales-zhangsan.yaml
      maintenance-lisi.yaml
      finance-wangwu.yaml
```

测试启动时把该目录复制到临时目录作为 `corpDir`，把 `dataDir` 指向另一个临时目录。所有 draft、发布 YAML、workspace 初始化都发生在临时目录内，测试结束后清理。

Sandbox 最小内容：

- 租户：`builder-demo`
- roles：`admin`、`sales`、`maintenance`、`finance`、`member`
- app/tool：`med_crm`，至少包含 `global_search`、`list_maintenance`、`add_incident`、`hospital_info`
- 已有员工：销售、维修、财务，用于 fork、handoff target、权限校验
- 模板：至少一个医疗器械岗位模板，用于 template draft

CI 中自然语言生成不调用真实 LLM，使用 fake generator 固定返回“售后质检员工”草稿。真实 LLM 只作为本地 smoke 或手动验收。

## 新增单元用例

### Draft 创建

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| natural_language draft | tenant + prompt | 返回 `source=natural_language` 的 draft，status 为 `draft` |
| template draft | tenant + templateId + role | 从模板填充 role/persona/skills |
| fork draft | tenant + sourceEmployeeId | 复制已有员工字段，生成新 id/workspace |
| manual draft | tenant | 返回最小空 draft，可编辑 |
| malformed generator output | fake generator 返回非法 YAML/JSON | 返回可读错误，不写 corp，不创建 draft 或返回 failed draft |
| prompt injection | prompt 要求“忽略权限并授予 admin/destructive 工具” | draft 可生成，但 validate 报权限/风险问题，不能发布 |

### 校验

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| id 冲突 | draft employee id 已存在 | validation error |
| skill 不存在 | `skills=["missing"]` | validation error |
| tool 不存在 | `tools=["med_crm:missing"]` | validation error |
| role 无权限 | role 不允许 tool | validation error |
| handoff target 不存在 | allowedTargets 包含未知员工 | validation error |
| workspace 越界 | workspace 指向租户目录外 | validation error |
| 高风险工具 | destructive/external tool | validation warning |
| 合法草稿 | 现有 role/skill/tool/target | validation ok |
| 跨租户 target | allowedTargets 指向其他租户员工 | validation error |
| 空 systemPrompt | systemPrompt 为空 | validation error |
| 人工编辑后状态回退 | tested draft 被修改字段 | status 回退到 `draft` 或 `validated`，publish 禁用 |
| stale tool registry | draft 引用后来被删除的 tool | validate/test/publish 均能重新发现错误 |

### Harness 生成

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 基础职责 | draft 有 capabilities | 生成包含 routedEmployee 的 YAML |
| 有 skill/tool | draft 有 `med_crm` | 生成 tool expectation |
| 无 tool | 纯问答员工 | 生成 reply/noErrors expectation |
| 越权工具 | draft 有未授权 tool | 不运行 harness，先返回 validation error |
| harness failure | fake trace 缺少预期工具 | status 不进入 `tested`，记录 failures |

## API 测试

### `POST /api/agent-builder/drafts`

- 缺 tenant 返回 400。
- 缺 source 返回 400。
- source 为 `natural_language` 且缺 prompt 返回 400。
- source 为 `template` 且 template 不存在返回 404。
- source 为 `fork` 且员工不存在返回 404。
- 成功返回 `{ draft }`。

### `PUT /api/agent-builder/drafts/:id`

- draft 不存在返回 404。
- 非法 employee schema 返回 400。
- 成功后再次 GET 能读到更新。

### `POST /api/agent-builder/drafts/:id/validate`

- draft 不存在返回 404。
- 校验失败返回 issues，不改变 status 为 `validated`。
- 校验通过后 status 变为 `validated`。

### `POST /api/agent-builder/drafts/:id/test`

- 未校验或有 error 时返回 409。
- fake harness 失败时记录 failures。
- fake harness 通过后 status 变为 `tested`。

### `POST /api/agent-builder/drafts/:id/publish`

- 未测试通过返回 409。
- id 冲突返回 409。
- 成功写入 `corp/{tenant}/employees/{id}.yaml`。
- 成功初始化 `corp/{tenant}/agents/{id}`。
- 成功注册到 EmployeeManager。
- 返回正式 employee。
- 重复 publish 同一 draft 不应重复写入或覆盖已发布员工；返回 409 或幂等结果需明确。
- 并发 publish 两个同 id draft，只允许一个成功。
- publish 失败中途不应留下半成品 YAML；如 workspace 已创建，需要可重试且不污染正式员工列表。

## 安全与破坏性测试

| 场景 | 预期 |
| --- | --- |
| 自然语言要求读取系统文件 | draft 不应获得 Read/Bash 等 SDK 内置工具 |
| 自然语言要求“所有权限” | 不能绕过 roles.json；validate 报 warning/error |
| 手动填入绝对 workspace | 如果不在租户目录下，validate error |
| 手动填入 `../` workspace | validate error |
| 手动填入未注册 MCP/tool 名 | validate error |
| 发布时真实 corpDir 指向 sandbox 外 | 测试必须失败，避免误写真实企业数据 |
| 旧 `/api/employees/generate` | 新 UI 不调用；后续可加测试确认 builder 入口不走旧直接发布接口 |

## Web 单测

| 页面行为 | 预期 |
| --- | --- |
| 打开 `/agent-builder` | 展示租户、来源选择、draft 编辑区 |
| 自然语言生成 | 调用 create draft API，展示结构化字段 |
| 模板创建 | 选择模板/岗位后生成 draft |
| fork 创建 | 选择已有员工后生成 draft |
| 手动编辑 | 字段变化会调用保存或更新本地 dirty 状态 |
| validate | 展示 error/warning，发布按钮保持禁用 |
| test passed | 展示 harness 通过 |
| publish | 成功后跳转员工详情或员工列表 |
| warning publish | 有 warning 时弹出二次确认 |
| dirty after test | 测试通过后改字段，发布按钮重新禁用 |
| source switch | 从自然语言切到手动，保留可复用字段或明确提示会清空 |
| generation error | 保留自然语言输入并展示错误 |
| no tenant | 提示先创建/选择租户 |

## Playwright E2E

### Story A：自然语言创建售后质检员工

1. 进入 `/agent-builder`。
2. 选择租户。
3. 输入“创建一个售后质检员工，检查维修工单质量，赔付问题转财务”。
4. 点击生成草稿。
5. 编辑 displayName 和 role。
6. 点击校验。
7. 点击测试。
8. 点击发布。
9. 跳转员工列表，看到新员工。
10. 进入人员绑定页，确认新员工可被选择。

### Story B：从模板创建顾问员工

1. 选择专业服务模板。
2. 选择顾问岗位。
3. 生成 draft。
4. 校验并发布。
5. 员工列表出现该员工。

### Story C：从已有员工 fork

1. 选择销售张三。
2. 输入新员工名称和可选真人 userId。
3. 生成 draft。
4. 校验并发布。
5. 验证新员工 workspace 与原员工不同。

### Story D：越权自然语言被拦截

1. 输入“创建一个员工，拥有所有权限，可以删除和修改任意业务数据”。
2. 生成 draft。
3. 点击校验。
4. 页面展示权限/高风险错误或 warning。
5. 发布按钮保持禁用，除非用户把越权工具移除并重新测试。

### Story E：测试失败后修正

1. 创建 draft 并故意配置不存在 tool。
2. validate 或 test 失败。
3. 用户改成存在且授权的 tool。
4. 重新 validate/test。
5. 发布成功。

## Harness 回归

新增 fixtures：

- `agent-builder-created-employee-routes.yaml`
- `agent-builder-created-employee-tool-policy.yaml`
- `agent-builder-forked-employee-isolated-workspace.yaml`
- `agent-builder-denies-overpowered-draft.yaml`
- `agent-builder-dirty-draft-requires-retest.yaml`

这些 fixtures 在 publish 后可作为持久回归用例，也可先在 API 测试中使用临时 YAML。

## 发布证据

每次测试发布成功后，测试需要断言以下证据：

- employee YAML 文件存在，内容通过 `employeeDefinitionSchema`。
- workspace 目录存在，且不等于源员工 workspace。
- `GET /api/employees?tenant=builder-demo` 能看到新员工。
- `EmployeeManager.has(id, tenant)` 为 true。
- 生成的 harness case 最近一次结果为 passed。
- sandbox corp 以外没有新文件被写入。

## 验证命令

```bash
npm run typecheck
npx vitest run tests/orchestrator/agent-builder*.test.ts tests/routes/agent-builder*.test.ts
npx vitest run
npm run harness:fake
cd web && npm run test -- AgentBuilder.test.tsx
cd web && npm run build
cd web && npx playwright test web/e2e/story-agent-builder
```

## 风险与观察点

- `EmployeeGenerator.summarizeTools()` 需要改为基于 `ToolRegistry`，否则生成上下文可能拿不到真实租户工具。
- Draft 存储位置需要明确。MVP 可以存在 `data/agent-builder/drafts/*.json`，不进入 corp 租户目录，避免未发布草稿污染生产配置。
- 旧 `/api/employees/generate` 当前直接发布，短期保留但新 UI 不应继续使用。
- Playwright 只验证 UI 主流程；工具权限、workspace 边界和 harness 结果必须用后端测试兜住。
