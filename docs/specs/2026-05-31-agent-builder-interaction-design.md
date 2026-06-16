# Agent Builder Interaction Design

**日期**: 2026-05-31
**状态**: Implemented
**关联**:
- [Agent Builder Requirements](./2026-05-31-agent-builder-requirements.md)
- [Agent Builder Test Plan](./2026-05-31-agent-builder-test-plan.md)

## 设计目标

Agent Builder 的前端不是“生成 YAML 的文本框”，而是一个让企业管理员放心创建数字员工的控制台。用户需要清楚知道：

- 当前员工草稿从哪里来。
- 系统建议了什么，哪些是用户确认过的。
- 这个员工会拥有哪些能力和权限。
- 发布前哪些校验和测试已经通过。
- 发布后下一步该绑定人、试聊还是继续编辑。

核心原则：自然语言是填表助手，结构化表单是事实来源，Review 面板是发布前门禁。

## 页面信息架构

路径：`/agent-builder`

```text
┌──────────────────────────────────────────────────────────────┐
│ Header: Agent Builder | Tenant Switcher | Draft Status        │
├───────────────┬──────────────────────────────┬───────────────┤
│ Create Panel  │ Structured Editor             │ Review Panel   │
│ 来源与输入     │ 员工配置表单                  │ 校验/测试/发布  │
│               │                              │               │
└───────────────┴──────────────────────────────┴───────────────┘
```

### Header

展示：

- 页面标题：`创建数字员工`
- 当前租户选择器
- Draft 状态 chip：`未创建` / `草稿` / `已校验` / `已测试` / `已发布`
- 保存状态：`已保存` / `有未保存更改` / `保存失败`

交互：

- 切换租户前，如果当前 draft dirty，需要弹出确认。
- 已发布 draft 不允许直接编辑；用户要编辑时创建新 draft 或 fork 已发布员工。

## 左侧：Create Panel

左侧是创建来源，不承担最终审核。

### 来源选择

使用 segmented control：

- `自然语言`
- `模板`
- `Fork`
- `手动`

切换来源时：

- 如果当前没有 draft，直接切换。
- 如果当前 draft dirty，弹窗确认：`切换创建方式会丢弃未保存更改`。
- 如果当前 draft 已保存但未发布，允许保留并提示“当前草稿不会自动删除”。

### 自然语言模式

控件：

- 多行输入框：岗位/职责描述。
- 可选 quick chips：
  - `销售`
  - `客服`
  - `售后`
  - `财务`
  - `质检`
  - `项目经理`
- 按钮：`生成草稿`

生成中：

- 按钮 loading。
- 输入框仍可滚动，但禁用再次提交。
- 中间 Editor 显示 skeleton。

成功：

- 创建 draft。
- 自动切到 Editor 的 `身份` 分组。
- Review Panel 显示“AI 建议，待校验”。

失败：

- 保留自然语言输入。
- 展示错误。
- 提供按钮：`重试`、`转为手动填写`。

### 模板模式

控件：

- 行业模板 select/card list。
- 岗位 select/card list。
- 模板摘要：职责、默认 skills、默认 handoff targets。
- 按钮：`使用模板创建草稿`

成功后创建 draft，并标记 `source=template`。

### Fork 模式

控件：

- 员工搜索/筛选：
  - 按 role
  - 按 skill
  - 按 tenant
- 源员工卡片：displayName、role、skills、workspace。
- 新员工基础字段：
  - displayName
  - role
  - humanUserId 可选
- 按钮：`基于此员工创建草稿`

Fork 草稿必须醒目标注：

- 不复制 memory。
- 不复制 session。
- workspace 会生成新目录。

### 手动模式

控件：

- 按钮：`创建空白草稿`
- 可选起点：
  - 纯问答员工
  - 业务工具员工
  - 协作/转交员工

## 中间：Structured Editor

结构化表单是最终事实来源。

### 分组

使用 tabs 或 accordion：

1. `身份`
2. `Prompt`
3. `能力`
4. `协作`
5. `工作目录`
6. `计划任务`
7. `测试样例`

### 身份

字段：

- `employee.id`
  - 自动 slug。
  - 手动编辑时即时检查格式。
  - 已发布后不可改。
- `displayName`
- `description`
- `role`
  - select + create-new-role 入口。
- `model`
- `humanUserId`

即时提示：

- id 冲突显示 inline error。
- role 不存在显示 warning，并说明发布时是否会创建 role template。

### Prompt

字段：

- `systemPrompt`

交互：

- 大文本编辑器。
- 右侧或下方显示 AI 建议来源说明：
  - 哪些句子来自自然语言。
  - 哪些来自模板。
  - 哪些来自 fork 源员工。
- 按钮：
  - `根据表单重新整理 Prompt`
  - `恢复上次生成`

约束：

- systemPrompt 为空不能校验通过。
- 不在页面上隐藏 prompt 内容，发布前必须可见。

### 能力

字段：

- `skills`
- `tools`
- `capabilities`

交互：

- skills 用 multi-select，来源于租户已安装 skills。
- tools 根据 skills 联动展示。
- tools 按风险分组：
  - read
  - internal_write
  - destructive
  - external
- 高风险工具以 warning style 标记。

选择逻辑：

- 选择 skill 后默认展示该 skill 的可用 tools，但不自动授予所有 tools。
- 用户可以只选择部分 tools。
- 如果 role 无权调用某 tool，显示 `权限不足` chip。

### 协作

字段：

- `allowedTargets`

交互：

- 多选员工卡片。
- 只展示同租户员工。
- 卡片展示 role、能力、是否在线/已注册。

错误：

- target 不存在或跨租户，inline error。

### 工作目录

字段：

- `workspace`

默认：

```text
agents/{employeeId}
```

展示：

- 最终解析路径。
- 是否新目录。
- fork 场景展示源 workspace 和新 workspace 对比。

约束：

- 不允许 `../`。
- 不允许租户目录外绝对路径。
- 发布前必须确认不会复用源员工 workspace。

### 计划任务

MVP 可折叠展示。

字段：

- schedule triggers。

默认不开启。

交互：

- `新增计划任务`
- cron/interval/once/event 选择。
- prompt 输入。

### 测试样例

展示 Builder 自动生成的 harness case 草稿。

控件：

- 用户消息输入。
- 预期 routedEmployee。
- 预期 tool names。
- 预期 reply contains。
- 预期 handoff count。

交互：

- 可以自动生成。
- 可以手动编辑。
- 每次测试使用当前 harness case。

## 右侧：Review Panel

Review Panel 固定在右侧，始终可见。

### 区块

1. `来源`
   - source
   - templateId/sourceEmployeeId/natural language prompt 摘要

2. `发布影响`
   - employee id
   - YAML 写入路径
   - workspace 路径

3. `权限`
   - skills 数量
   - tools 数量
   - 写权限工具数量
   - 高风险工具列表

4. `协作`
   - allowedTargets

5. `校验`
   - error count
   - warning count
   - 最近校验时间

6. `测试`
   - harness status
   - 最近测试时间
   - 失败摘要

7. `动作`
   - `保存草稿`
   - `校验`
   - `运行测试`
   - `发布`

### 按钮状态

| 状态 | 保存 | 校验 | 测试 | 发布 |
| --- | --- | --- | --- | --- |
| 无 draft | disabled | disabled | disabled | disabled |
| draft dirty | enabled | enabled | disabled | disabled |
| validation error | enabled | enabled | disabled | disabled |
| validation warning only | enabled | enabled | enabled | disabled |
| tested passed | enabled | enabled | enabled | enabled |
| tested passed 后再次编辑 | enabled | enabled | disabled | disabled |
| published | disabled | disabled | disabled | disabled |

## 发布确认弹窗

点击发布后弹窗展示：

- 员工：`displayName (id)`
- 租户
- YAML 路径
- workspace 路径
- skills/tools 列表
- warning 摘要
- harness 最近结果

按钮：

- `取消`
- `确认发布`

如果存在 warning，确认按钮文案改为 `确认发布（含风险提示）`。

## 发布成功态

发布成功后显示 success panel：

- `查看员工`
- `绑定人员`
- `发起试聊`
- `复制 harness case`

页面状态变为 `published`，禁止继续编辑当前 draft。

## 错误态

### 校验错误

表现：

- 字段旁 inline error。
- Review Panel error list 可点击定位字段。

### Harness 失败

表现：

- 展示失败 expectation。
- 展示实际 trace 摘要。
- 提供 `编辑测试样例` 和 `回到能力配置`。

### 发布失败

表现：

- 展示失败阶段：
  - write_yaml
  - init_workspace
  - register_employee
- 如果是可重试错误，保留 draft 状态。
- 如果可能产生半成品，提示用户重新校验。

## 移动端和窄屏

MVP 优先桌面。

窄屏行为：

- Create Panel、Editor、Review Panel 改为顶部 tabs。
- Review Panel 的发布按钮固定底部。
- 大文本 prompt 编辑器高度限制，避免挤压动作按钮。

## 可访问性

- 所有按钮有明确 disabled 原因。
- error/warning 使用文本，不只靠颜色。
- 发布确认弹窗支持 Escape 关闭。
- Review Panel 的 error item 可键盘聚焦。

## 实现建议

前端组件拆分：

```text
web/src/pages/AgentBuilder.tsx
web/src/components/agent-builder/CreatePanel.tsx
web/src/components/agent-builder/StructuredEditor.tsx
web/src/components/agent-builder/ReviewPanel.tsx
web/src/components/agent-builder/PublishConfirmDialog.tsx
web/src/components/agent-builder/HarnessCaseEditor.tsx
web/src/components/agent-builder/ValidationIssueList.tsx
```

状态建议：

- 页面本地维护 draft 编辑态。
- 保存成功后以服务端 draft 为准。
- 不新建 Zustand store，除非后续需要跨页面恢复多个 draft。

## Frontend Done

- 四种创建来源都能创建 draft。
- 用户能完整查看和编辑结构化字段。
- Review Panel 清楚展示权限、风险、workspace、测试状态。
- Dirty draft 会禁用发布并要求重新测试。
- 有 warning 时发布需要二次确认。
- 发布后能跳转员工列表/绑定/试聊。
- 主要错误态有可恢复路径。
