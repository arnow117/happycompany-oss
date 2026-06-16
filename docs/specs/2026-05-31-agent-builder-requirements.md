# Agent Builder Requirements

**日期**: 2026-05-31
**状态**: Implemented
**关联**:
- [ADR-002 数字员工 Demo 与自生成架构](../adr/2026-05-11-002-digital-employee-demo.md)
- [ADR-003 调度员退化为纯路由层](../adr/2026-05-21-003-dispatcher-as-router-fork-instances.md)
- [架构总览](./2026-05-21-architecture-overview.md)
- [Harness Story Coverage Map](./2026-05-31-harness-story-coverage-map.md)
- [Agent Builder Interaction Design](./2026-05-31-agent-builder-interaction-design.md)

## 背景

当前平台已经具备数字员工运行时、员工 YAML、租户工具注册、角色权限、handoff、memory、harness 验收等基础能力。但“创建一个可生产使用的新数字员工”仍然偏工程化：要理解 YAML、skills/tools、roles.json、workspace、handoff target 和测试用例。

历史代码中已有若干拼图：

- `EmployeeGenerator` 支持自然语言生成员工 YAML，但目前直接写入并注册，缺少 draft 生命周期。
- `Employees` 页面已有自然语言生成、模板编辑、fork、optimize，但交互混在一个大页面中。
- `EmployeeNetwork` 支持从模板或 workdir 导入员工网络，更偏 onboarding。
- 模板体系已有行业、岗位、workflow、contract，但还没有统一到“创建单个数字员工”的结构化 builder。

本需求要把这些能力收敛为一个 Agent Builder：让企业管理员可以通过自然语言、模板、fork 或手动方式创建一个结构化草稿，经过校验和测试后，一键发布为正式数字员工。

## 核心决策

自然语言不是生产发布入口，只是结构化填表助手。

```
自然语言 / 模板 / fork / 手动填写
  -> AgentDraft
  -> 结构化编辑和审核
  -> 校验权限、工具、工作目录、handoff
  -> 生成并运行 harness 验收
  -> 发布为 corp/{tenant}/employees/{id}.yaml
  -> 注册到 EmployeeManager
```

也就是说，所有创建来源最终都必须归一为同一个 `AgentDraft`。发布只认结构化 draft，不认原始自然语言。

## 用户故事

### 故事 1：自然语言起草数字员工

企业管理员输入：

> 创建一个售后质检员工，负责检查维修工单质量，发现赔付或开票问题时转交财务。

系统生成一个 `AgentDraft`：

- 员工身份、职责、system prompt
- role 建议
- skills/tools 建议
- handoff target 建议
- capabilities
- workspace 建议
- harness 测试样例建议
- 风险和缺失项提示

用户可以继续编辑草稿，不会直接生成正式员工。

### 故事 2：从结构化模板快速组装

管理员可以从已有模板选择：

- 行业模板：医疗器械、专业服务、电商等
- 岗位人格：销售、维修、财务、顾问、项目经理、客服、仓储等
- 已安装 skill：如 `med_crm`
- 可转交员工：如 `finance-wangwu`

系统把选择结果组装为同一个 `AgentDraft`，用户可以继续编辑。

### 故事 3：从已有员工 fork

管理员选择已有员工，例如销售张三，点击“基于此员工创建”：

- 复制职责、prompt、skills/tools、capabilities
- 生成新的 id、displayName、workspace
- 可绑定真人 userId
- 默认不复制历史 memory 和 session
- 进入 draft 编辑态

### 故事 4：发布前校验

管理员点击“校验”后，系统必须检查：

- employee id 格式合法且不冲突
- tenant 存在
- role 存在，或可安全创建
- skills 存在
- tools 在 `ToolRegistry` 中注册
- `roles.json` 允许该 role 调用声明的工具
- handoff target 都存在且同租户
- workspace 位于租户目录内
- systemPrompt 非空
- 对高风险工具给出风险提示

校验失败不能发布。

### 故事 5：发布前测试

Builder 根据 draft 生成最小 harness case：

- 输入：一个能触发该员工职责的用户消息
- 预期：路由到新员工
- 预期：需要的 skill/tool 被调用，或至少能通过 fake trace 验收
- 预期：无越权错误

MVP 阶段允许先做 fake harness。真实后端 smoke 后续接入。

### 故事 6：一键发布

发布成功后：

- 写入 `corp/{tenant}/employees/{id}.yaml`
- 初始化 `corp/{tenant}/agents/{id}` 工作目录
- 如需要，补充 role template
- 注册到 `EmployeeManager`
- 页面跳转到员工详情或员工列表
- 新员工立即能被企业人员绑定或入口路由选择

## 非目标

MVP 不做以下能力：

- 不自动创建新的业务 app/server。
- 不自动授予高风险权限。
- 不直接从自然语言修改 `roles.json` 的危险权限。
- 不复制已有员工 memory/session。
- 不把 Builder 做成通用低代码 workflow 平台。
- 不在发布前强制跑真实 LLM 链路，先以 fake harness 和结构校验为 gate。

## AgentDraft 数据模型

```ts
type AgentDraftSource = 'natural_language' | 'template' | 'fork' | 'manual';

interface AgentDraft {
  id: string;
  tenant: string;
  source: AgentDraftSource;
  status: 'draft' | 'validated' | 'tested' | 'published';
  createdAt: number;
  updatedAt: number;

  input?: {
    naturalLanguage?: string;
    templateId?: string;
    sourceEmployeeId?: string;
  };

  employee: {
    id: string;
    displayName: string;
    description: string;
    model: string;
    systemPrompt: string;
    maxTurns: number;
    role: string;
    skills: string[];
    tools: string[];
    allowedTargets: string[];
    capabilities: string[];
    workspace: string;
    humanUserId?: string;
    schedule?: unknown;
  };

  validation: {
    ok: boolean;
    issues: AgentBuilderIssue[];
  };

  harness?: {
    yaml: string;
    lastResult?: 'passed' | 'failed' | 'error';
    failures?: string[];
  };
}

interface AgentBuilderIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}
```

## API 需求

### `POST /api/agent-builder/drafts`

创建 draft。支持四种来源：

```ts
type CreateDraftBody =
  | { source: 'natural_language'; tenant: string; prompt: string }
  | { source: 'template'; tenant: string; templateId: string; role: string }
  | { source: 'fork'; tenant: string; sourceEmployeeId: string }
  | { source: 'manual'; tenant: string };
```

返回：

```ts
{ draft: AgentDraft }
```

### `GET /api/agent-builder/drafts/:id`

读取 draft。

### `PUT /api/agent-builder/drafts/:id`

保存结构化编辑后的 draft。

### `POST /api/agent-builder/drafts/:id/validate`

运行结构校验、权限校验、引用校验。

### `POST /api/agent-builder/drafts/:id/test`

生成或运行 harness case。MVP 先支持 fake mode。

### `POST /api/agent-builder/drafts/:id/publish`

发布为正式员工。只有校验无 error 且 harness 通过时允许发布。

## Web 页面需求

新增页面 `/agent-builder`。

### 布局

- 顶部：租户选择、创建来源选择。
- 左侧：创建输入区。
  - 自然语言输入
  - 模板选择
  - fork 来源员工选择
  - 手动创建
- 中间：结构化表单。
  - 基本信息
  - Persona/system prompt
  - role
  - skills/tools
  - handoff target
  - workspace/memory
  - schedule
- 右侧：校验与测试面板。
  - validation issues
  - harness YAML 预览
  - 最近测试结果
  - 发布按钮

### 交互约束

- 任何来源创建后都进入 draft 编辑态。
- 发布按钮默认 disabled，直到 validation 无 error 且 harness 通过。
- 自然语言生成失败时保留用户输入，不清空。
- 用户可以手动覆盖 AI 建议字段。
- tools/skills/allowedTargets 尽量用下拉或多选，不允许用户只能手写。
- 高风险工具需要 warning 展示。

## 产品设计补充

### 创建模式

Builder 需要把四种创建方式放在同一套 draft 模型下，但 UI 上要明确区分用户心智：

| 模式 | 用户意图 | 系统行为 |
| --- | --- | --- |
| 自然语言 | “我描述一个岗位，你帮我填表” | 生成建议字段，并展示建议理由和风险 |
| 模板 | “我从标准岗位快速开始” | 预填 persona、role、workflow、handoff 建议 |
| Fork | “我复制一个已有员工给新人/新职责” | 复制配置但强制生成新 id/workspace，不复制 memory/session |
| 手动 | “我知道我要配什么” | 提供空 draft 和结构化选择器 |

自然语言生成结果必须标注为“AI 建议”，不能表现成最终配置。用户保存或发布前必须至少看到结构化字段。

### Review 面板

发布前页面右侧需要有一个固定 Review 面板，聚合以下信息：

- 权限影响：这个员工最终会拥有哪些 skill/tool。
- 写权限风险：哪些工具是 `internal_write`、`destructive` 或 `external`。
- 协作影响：会允许 handoff 给哪些员工。
- 数据边界：workspace 最终落在哪里，是否是新目录。
- 测试状态：validation 和 harness 最近一次结果。
- 来源说明：自然语言、模板、fork 或手动创建，以及源员工/模板 id。

Review 面板的目标是让管理员快速回答：“这个员工是谁、能做什么、能影响哪些数据、发布前测过什么。”

### 字段级解释

自然语言生成 draft 时，系统应尽量为关键建议字段保留解释：

- 为什么建议这个 role。
- 为什么选择这些 skills/tools。
- 为什么建议这些 handoff targets。
- 哪些用户描述没有被覆盖。

MVP 可以把解释放在 draft metadata 中；UI 上先以简短提示展示，不要求复杂可视化。

### 发布确认

发布按钮点击后需要二次确认，确认内容包括：

- 即将创建的员工 id 和 displayName。
- 写入路径 `corp/{tenant}/employees/{id}.yaml`。
- workspace 路径。
- 授权工具列表。
- 如果有 warning，必须展示 warning 摘要。

有 validation error 时不能确认发布。有 warning 时可以发布，但必须经过确认。

### 发布后的入口

发布成功后，页面应提供三个明确动作：

- 进入员工详情/员工列表查看。
- 去人员绑定页面把真人绑定到该员工。
- 用 harness 或 Web 聊天入口发起一次试聊。

### 旧入口降级

`Employees` 页面已有的“生成 Agent”和 fork 入口后续应降级为跳转入口：

- 点击“生成 Agent”进入 `/agent-builder?source=natural_language`。
- 点击 fork 进入 `/agent-builder?source=fork&employeeId=...`。
- 不再从旧页面直接调用 `/api/employees/generate` 创建生产员工。

### 空态和失败态

- 没有租户时：引导去创建/实例化租户，而不是展示空表单。
- 没有可用 skill/tool 时：允许创建纯问答员工，但明确提示无法处理业务数据。
- 自然语言生成失败：保留输入，允许切换到手动模式继续填。
- validate 失败：字段旁定位错误，Review 面板聚合错误。
- harness 失败：展示失败断言和 trace 摘要，允许回到表单修改。

## 与现有模块关系

| 模块 | 关系 |
| --- | --- |
| `EmployeeGenerator` | 保留生成能力，但改为输出 draft，不直接发布 |
| `EmployeeApi` | 现有 generate/fork 可逐步迁移到 builder API；短期保留兼容 |
| `TemplateLoader` | 用于从行业/岗位模板创建 draft |
| `ToolRegistry` | 提供可选工具和工具引用校验 |
| `AuthGate` | 校验 role 是否有权调用 draft 中声明工具 |
| `EmployeeManager` | publish 后注册员工 |
| `MessageIngressRuntime` / Harness | 发布前测试和后续回归 |
| `Employees` 页面 | 后续保留员工列表/详情，创建入口迁移到 `/agent-builder` |
| `EmployeeNetwork` 页面 | 继续负责企业网络 onboarding，不承接单员工 builder |

## 迁移策略

1. 保留现有 `/api/employees/generate` 和 `/api/employees/fork`，避免打断旧页面。
2. 新增 builder API 和页面。
3. 等 builder 稳定后，把 `Employees` 页面里的自然语言生成和 fork 入口改成跳转到 `/agent-builder`。
4. 后续再考虑废弃旧的直接生成接口。

## Done 定义

- 可以从自然语言创建 draft。
- 可以从模板创建 draft。
- 可以从已有员工 fork 创建 draft。
- 可以手动编辑 draft。
- 校验能发现 id 冲突、工具不存在、权限不足、handoff target 不存在、workspace 越界。
- fake harness 能为 draft 生成并跑通最小验收。
- publish 会写入员工 YAML、初始化 workspace、注册 EmployeeManager。
- Web 页面能完成从创建到发布的闭环。
- 旧的员工列表、绑定、聊天路由不回归。
