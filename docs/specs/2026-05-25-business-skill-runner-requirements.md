# 业务 Skill Runner 与 MCP 边界收敛需求

> 日期: 2026-05-25
> 状态: 草案
> 关联: [架构概览](./2026-05-21-architecture-overview.md), [ADR-003 调度员退化为纯路由层](../adr/2026-05-21-003-dispatcher-as-router-fork-instances.md)

## 背景

HappyCompany 的数字员工目标是：管理员定义员工 YAML，员工通过绑定的 skill 和 skill 内可执行文件处理真实业务，权限模型在 skill/CLI 执行边界做管控。

当前实现曾存在历史混合态：

- `corp/{tenant}/.claude/skills/*` 表达员工可理解的业务能力。
- `corp/{tenant}/apps/*/tools.json` 表达业务工具注册、schema 与风险等级。
- `SkillBridge` 会把业务工具包装成 SDK MCP tools 并注入员工运行时。
- `AuthGate` 主要按 skill/CLI 入口设计权限，但业务 MCP 注入让权限边界变得不一致。

这导致数字员工在真实 IM 链路中可能出现：

- 业务员工绕过 skill 心智，直接尝试 MCP 工具或 Bash 探环境。
- 业务 MCP tool 名称、SDK schema、权限 hook 之间出现兼容问题。
- 示例医疗租户从早期通用 Agent 拆分多员工后，旧 skill/旧工具残留污染员工配置。

## 目标

将业务执行链路收敛为：

```
用户消息
  -> 入口 Bot / 员工路由
  -> 数字员工 YAML
  -> 员工绑定的 skill
  -> 平台受控 Skill Runner
  -> skill 内声明的 executable/CLI
  -> AuthGate + ToolRegistry 权限校验
  -> 业务结果
```

平台侧原生 MCP 不受影响。业务 MCP 不再作为员工直接可见的主要工作界面。

## 非目标

- 不移除平台原生 MCP 能力。
- 不移除 `ToolRegistry` / `tools.json`。
- 不推翻现有员工 YAML、企业人员绑定、IM 入口和 handoff 编排。
- 不让模型自由调用 Bash、Read、Grep 等通用文件系统工具处理业务请求。

## 核心需求

### R1. MCP 边界

平台 MCP 与业务能力必须分层：

| 类型 | 是否保留 MCP | 说明 |
|---|---:|---|
| 平台协调 MCP | 是 | `handoff`、调度、状态、写锁、观测等平台能力 |
| 平台宿主原生 MCP | 是 | Codex/Claude Code/运行宿主注入的 MCP，不由业务员工收敛改动影响 |
| 租户业务工具 MCP | 否，默认不直出 | `med_crm:*`、发票、维修记录、人审等业务能力走 skill runner |

数字员工运行时不得默认注入 `skill-tools:<employee-id>` 形式的业务 MCP tools。

### R2. 受控 Skill Runner

平台提供一个受控业务执行入口，概念接口为：

```ts
runSkill({
  tenantName: string,
  employeeId: string,
  skill: string,
  command: string,
  args: Record<string, unknown>
})
```

Runner 必须完成：

- 校验员工 YAML 是否绑定该 skill。
- 校验 skill 是否存在于 `corp/{tenant}/.claude/skills/{skill}`。
- 校验 command 是否存在于 `tools.json` 或 skill manifest。
- 使用 `AuthGate` 校验 `employee:{employeeId}` 对目标工具的权限。
- 执行固定入口，不允许模型拼接任意 Bash。
- 返回结构化结果和可读摘要。
- 记录日志，包含 tenant、employeeId、skill、command、riskLevel、success/failure。

### R3. `tools.json` 定位

`tools.json` 继续保留，但定位调整为：

- 工具注册表。
- schema 来源。
- 风险等级来源。
- 权限匹配对象。
- CLI/server 调用元数据。

它不再意味着“这些工具会直接作为员工可见 MCP tools 注入模型”。

自 [ADR-006](../adr/2026-06-04-006-tenant-skill-package-runtime.md) 起，`tools.json` 必须位于 skill package 内：

```text
corp/{tenant}/.claude/skills/{skill}/tools.json
```

旧的 `corp/{tenant}/apps/{app}/tools.json` 不再作为注册源。

### R4. 权限模型

权限边界以结构化 skill command 为主，不以自由 Bash 字符串为主。

必须支持：

- role tools 白名单：如 `med_crm:global_search`。
- 风险等级：read、internal_write、destructive、external。
- 写入类操作继续接入写锁或确认机制。
- 未授权命令返回明确错误，不进入实际 CLI/server 调用。

可保留 Bash CLI 解析作为兼容层，但不作为员工运行时主路径。

### R5. 数字员工运行时工具可见性

业务员工默认只能看到：

- 自己的系统提示词。
- 自己绑定的 skill 说明。
- 平台允许的协调工具，如 handoff。
- 一个受控 skill runner 工具或等价机制。

业务员工默认看不到：

- 通用 Bash。
- 通用 Read/Grep/Glob。
- 租户业务 MCP tool 列表。
- 未绑定 skill 的执行入口。

### R6. 示例医疗租户配置清理

示例医疗目录必须从“早期通用 Agent + 多技能”收敛为“多数字员工”：

- 销售张三：绑定 `med_crm`，允许销售相关查询和必要写入。
- 销售赵六：从销售张三 fork 后应有独立员工定位，不应保留错误旧技能。
- 维修李四：绑定维修相关 skill/command。
- 财务王五：绑定合同、结算、发票相关 skill/command。
- HR、IT、行政：不应携带医疗 CRM 或旧通用 Agent 技能。
- 移除不存在或未安装的 skill 引用，如 `device_procurement`、`workflow-runner`、`device_knowledgebase`、`service-record`。
- `allowedTargets` 必须指向真实存在的员工 ID。
- 模型配置使用当前可用模型或继承全局配置，不保留不可用模型名。

### R7. Web 配置心智

Web 层应表达“员工绑定 skill/能力”，而不是让用户直接理解业务 MCP tool。

最低要求：

- 员工详情页能看到绑定 skill。
- 员工详情页能编辑 skill 绑定或至少展示其来源。
- people binding 链路能把真实人绑定到具体数字员工。
- 员工创建/导入后能自然进入绑定流程。

## 验收场景

### A1. 本地 IM Loop 销售查询

输入：

```text
/list
10
查一下今天有什么重点客户要跟进
```

预期：

- `/list` 返回示例医疗员工列表。
- 回复 `10` 切换到销售张三。
- 销售张三调用受控 skill runner。
- runner 调用 `med_crm` 允许的查询 command。
- 返回客户/医院/合同/招投标相关摘要。
- 日志中不得出现通用 Bash 探环境。

### A2. 未授权业务能力

销售员工请求财务专属写入或未绑定 skill command。

预期：

- runner 在权限校验阶段拒绝。
- 不执行 CLI/server。
- 返回明确权限原因。

### A3. 平台 MCP 不受影响

触发 handoff 或平台状态查询。

预期：

- 平台协调 MCP 正常可用。
- 业务 MCP 收敛不影响 handoff 编排。

### A4. 钉钉真实链路

用户在钉钉发送同样流程。

预期：

- 与本地 IM loop 一致。
- C2C/群消息发送成功。
- 没有反复回到员工选择器。

## 实现建议

优先短期闭环：

1. 引入 `SkillRunner` 服务，复用 `ToolRegistry`、`AuthGate`、`AppServerMgr`。
2. 修改员工运行时，不再注入业务 `skill-tools` MCP。
3. 保留 handoff 等平台 MCP。
4. 清理 `corp/acme/employees/*.yaml`。
5. 用本地 `scripts/im-loop.mjs` 跑销售链路。
6. 再跑钉钉真实链路。

中期还债：

1. 将 `SkillBridge` 改名或拆分，避免“skill -> MCP”语义继续误导。
2. Web 配置页按 skill/能力展示，不展示底层 MCP tool。
3. 将权限检查从 Bash 文本解析升级为结构化 command 校验。
4. 为每个租户增加配置卫生检查，检测不存在的 skill、悬空 target、不可用模型。

## 风险

- 如果 skill 目录没有标准 manifest，需要先约定 command schema 来源。
- 如果继续保留 Bash 兼容层，模型仍可能尝试探环境；员工运行时应默认隐藏 Bash。
- 若 MCP SDK 对自定义工具权限 hook 行为有版本差异，业务链路不应依赖业务 MCP 直出。
