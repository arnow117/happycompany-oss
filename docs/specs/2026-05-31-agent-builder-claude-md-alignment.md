# Agent Builder 与员工 CLAUDE.md 对齐

日期：2026-05-31

## 背景

Agent Builder 当前能创建数字员工草稿并发布为 `corp/{tenant}/employees/{employeeId}.yaml`。页面里的 Prompt 字段会写入 YAML 的 `systemPrompt`，但运行时员工的长期人格入口应该是员工 workspace 下的 `CLAUDE.md`。

这会导致一个产品语义问题：用户以为自己在编辑“这个员工长期如何工作”，但实际长期说明还没有稳定落到员工自己的 Claude Code 入口文件里。

## 用户故事

作为企业管理员，我在 Builder 中编辑一个数字员工时，希望我配置的身份、职责、边界、技能、工具和转交规则能变成这个员工长期稳定遵守的工作说明，而不是只在某次消息里临时拼进去。

作为平台维护者，我希望 YAML 继续承载机器可读配置，`CLAUDE.md` 承载 AI 可读的长期工作说明，二者有清晰分工。

## 目标设计

数字员工发布后至少包含两类产物：

- `corp/{tenant}/employees/{employeeId}.yaml`：平台结构化配置。
- `corp/{tenant}/agents/{employeeId}/CLAUDE.md`：员工长期 AI 工作说明。

Builder 的结构化字段映射如下：

| Builder 字段 | YAML | CLAUDE.md |
|---|---|---|
| ID / 展示名 / 描述 / 角色 | 保留 | 生成身份说明 |
| Prompt / 工作说明 | 保留为 `systemPrompt` | 写入“长期工作说明” |
| skills | 保留 | 写入“已绑定业务能力包” |
| tools | 保留 | 写入“可执行业务动作” |
| allowedTargets | 保留 | 写入“可转交对象” |
| capabilities | 保留 | 写入“路由关键词/能力标签” |
| workspace | 保留 | 决定 `CLAUDE.md` 落点 |

## 运行时规则

- `ClaudeAgent` 已经从 `agentDir/CLAUDE.md` 读取 persona，并作为 Claude Agent SDK `systemPrompt.append` 注入。
- 数字员工的 `agentDir` 与 `cwd` 都解析为员工 workspace。
- 因此员工长期人格、职责、SOP 和工具规则应落在 workspace `CLAUDE.md`。
- 运行时 user prompt 只保留当前用户消息、已授权命令摘要和短期调用规则，不再重复塞入完整 `systemPrompt`。

## 历史迁移

现有 `corp/acme/employees/*.yaml` 需要迁移：

- 为每个员工创建 `corp/acme/agents/{employeeId}/CLAUDE.md`。
- `CLAUDE.md` 内容由员工 YAML 中的 displayName、description、systemPrompt、skills、tools、allowedTargets、capabilities 生成。
- 保留 YAML 中的 `systemPrompt`，作为结构化来源和回滚兼容。

## 非目标

- 本次不移除 YAML 的 `systemPrompt` 字段。
- 本次不把 Builder 的 Prompt 拆成多个 UI 子字段。
- 本次不实现 dreaming 对 `CLAUDE.md` 的补丁审核流。
