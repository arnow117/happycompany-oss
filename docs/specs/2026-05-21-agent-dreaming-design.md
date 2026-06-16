# Agent Dreaming v2 — 工作流挖掘设计

> **Status**: Design proposal (project under refactor, implementation deferred)
> **Date**: 2026-05-21
> **Supersedes**: `2026-05-19-agent-dreaming-design.md`（旧版聚焦"记忆压缩"，此版改为"工作流还原"）
> **Owner**: arnow117

## 1. 背景与定位

### 1.1 为什么要做 Dreaming v2

旧版（2026-05-19）的 Dreaming 是"记忆压缩"思路：把碎片化对话浓缩成员工的长期记忆条目。但实际用户的需求不是"记住更多"，而是**还原工作流**：

> 一个销售可能"写一份合同"在心里就是 3 步：确认条款 → 起草初稿 → 走审批。
> 但他和数字员工的对话里，这 3 步被打散成 20 轮琐碎对话。
> Dreaming 要做的是：**从这些碎片里反向归纳出这 3 步**，把它做成可复用的 skill。

### 1.2 核心目标

- **输入**：员工最近 N 天的对话日志（来自 MessageStore SQLite）
- **过程**：识别多步骤工作流的结构 → 同角色之间用频次确认 → 生成结构化 SOP + skill YAML 半成品
- **输出**：放入 `pending-skills/` 待审区，管理员人工审核后入仓为正式 skill

### 1.3 非目标

- 不替代旧版"记忆压缩"的功能定位（旧设计保留为历史档案，未来如需要可作为独立 track）
- 不做全自动 skillify（必须 human-in-the-loop）
- 不做实时检测（cron 离线触发即可）

---

## 2. 关键决策汇总

| 维度 | 决策 | 理由 |
|------|------|------|
| 自动化程度 | **半自动**：dream 产出候选 SOP + YAML，人决定是否 skillify | 工作流是业务资产，必须经业务负责人审核才能入仓 |
| 识别标准 | **结构 + 频次** | 单次对话识别多步结构；同角色多人重复出现 → 确认是 SOP 而非偶然 |
| 输出形态 | **自然语言 SOP + 生成的 YAML** 双件 | 自然语言供 review，YAML 供直接落地 |
| 分析范围 | 先**单员工**找候选，再**同角色合并** | 单员工降噪，同角色找共性 |
| 时间窗口 | 默认**最近 1 天**，可配置 N 天，可开启增量模式 | 平衡性能与覆盖；增量避免重复扫描 |
| 触发方式 | **纯 cron** | 离线批处理，不影响在线流程 |
| 输出位置 | **统一 `pending-skills/` 待审区** | 与现有 skill marketplace 一致；管理员决定最终入哪一层（公司/小组/员工） |
| 数据源 | **MessageStore (SQLite)** | 已有的对话日志，包含完整 user/bot 文本 |
| LLM | **Anthropic SDK 直连**，默认 haiku | 离线分析任务，无需 session 状态；haiku 性价比高 |

---

## 3. 数据基础（关键澄清）

### 3.1 MessageStore 才是 dreaming 的输入源

旧设计误认为 `.session-*.json` 文件包含对话历史。**实际上 session 文件只存 sessionId**：

```json
{ "sessionId": "012dab7b-3c85-4445-89b1-1c2db3c54f3f" }
```

SDK 的对话状态在内部不可读出。**真正的对话文本在 `src/store.ts` 的 SQLite 库里**：

```ts
interface PersistedMessage {
  id: string;
  chatId: string;
  timestamp: number;
  botName: string;
  text: string;           // 完整文本
  source: 'user' | 'bot';
  fromBotName?: string;
  userId?: string;
}
```

可用 API：
- `listMessages(chatId, limit)`
- `getMessagesForChat(chatId, opts)`
- `getMessagesSince(timestamp)`

### 3.2 已有参考

`src/daily-summary.ts` 的 `generateDailySummary(store, botName)` 已经走过类似流程：拉 MessageStore + 调 LLM 生成摘要。Dreaming 复用同样的取数模式。

### 3.3 员工 workspace 是长期记忆与工作产物的落点

数字员工的 Claude Code SDK `cwd` 与 `agentDir` 已收敛为同一个员工 workspace：

```
corp/{tenant}/agents/{employeeId}/
```

因此 dreaming 相关的员工本地文件也必须落在该 workspace 内，而不是旧的 `data/memory/{botName}`：

```
corp/{tenant}/agents/{employeeId}/
├── CLAUDE.md                  # 员工本地 Claude Code 操作入口
├── memory/
│   ├── 2026-05-25.md          # 员工长期笔记/决策/偏好
│   └── preferences.md
├── dreaming/
│   ├── observations/          # 单员工观察
│   ├── candidates/            # 单员工候选 workflow
│   └── checkpoint.json
└── artifacts/
    ├── drafts/
    └── reports/
```

边界约束：

- MessageStore 是 dreaming 的聊天证据源，包含完整 user/bot 文本。
- `.session-*.json` 只保存 SDK `sessionId`，不作为 dreaming 输入源。
- `memory/` 是员工 workspace 下的长期笔记，不再按 bot 存在 `data/memory/`。
- dreaming 只能读写当前员工自己的 workspace；不能跨员工目录扫描。
- 业务数据仍只能通过 `SkillRunner + AuthGate + 白名单命令` 访问，dreaming 不直接扫描 `corp/{tenant}/.claude/skills/{skill}` 内的业务工程或数据。

### 3.4 CLAUDE.md 的长期定位

`employees/*.yaml` 是平台控制面的员工定义：身份、角色、skills、路由与权限。

`corp/{tenant}/agents/{employeeId}/CLAUDE.md` 是该员工 workspace 内 Claude Code 进程的 AI-friendly 操作入口：目录结构、允许维护的本地文件、禁止跨目录访问、如何使用 `run_skill`。

Dreaming 后续可以生成对 `CLAUDE.md` 的候选补丁，但必须进入审核流，不直接覆盖。

---

## 4. 两阶段流水线

```
[Phase 1: 单员工候选挖掘]
  对每个员工：
    1. 拉取最近 N 天的对话（按 chatId 聚合）
    2. 调 LLM 识别"多步骤工作流"结构
       - 提示词聚焦：是否有"先...后...再..."的步骤链？
       - 是否有阶段性产物（合同初稿 / 报价单 / 排期表）？
    3. 产出候选清单：[ { 主题, 步骤数, 步骤摘要, 触发证据 } ]
    4. 落地 → 该员工的临时候选库

[Phase 2: 同角色合并 + 频次确认]
  对每个 role（如"销售"、"客服"）：
    1. 收集该角色下所有员工的候选
    2. 按主题聚类（语义近似的候选合并）
    3. 频次确认：同一主题被 ≥K 人产出 → 认定为该角色 SOP
       K 默认 = 2，可配置
    4. 对每个被确认的 SOP：
       - 生成自然语言 SOP 文档（步骤、入口、阶段产物、退出条件）
       - 生成 skill YAML 半成品（名称、描述、参数、调用示例）
    5. 落地到 `pending-skills/<role>/<topic>-{timestamp}.{md,yaml}`
```

---

## 5. 配置项

```jsonc
{
  "dreaming": {
    "enabled": true,
    "trigger": {
      "cron": "0 3 * * *",        // 凌晨 3 点跑
      "type": "cron"
    },
    "window": {
      "days": 1,                  // 默认最近 1 天
      "incremental": true,        // 增量：只看自上次 dream 之后的新消息
      "incrementalCheckpoint": ".dreaming-checkpoint.json"
    },
    "confirmation": {
      "minRoleAgreement": 2       // 同角色至少 2 人共现，才认 SOP
    },
    "llm": {
      "provider": "anthropic",
      "model": "claude-haiku-4-5-20251001"
    },
    "output": {
      "pendingDir": "pending-skills"
    }
  }
}
```

---

## 6. 输出物示例

### 6.1 自然语言 SOP

```markdown
# SOP: 销售合同起草（候选）

**适用角色**：销售
**识别证据**：3 名销售在最近 7 天内重复出现此流程

## 步骤
1. **确认条款**：和客户确认价格、付款方式、交付时间
2. **起草初稿**：调用模板生成器输出合同 v1
3. **走审批**：将 v1 提交给法务，等待批注后修订

## 阶段产物
- 步骤 1 产出：条款清单（dict）
- 步骤 2 产出：合同 v1（markdown）
- 步骤 3 产出：合同 v_final（pdf）

## 退出条件
- 法务批注全部消化
- 客户在合同上签字
```

### 6.2 Skill YAML 半成品

```yaml
name: sales-contract-draft
description: 销售合同起草标准流程（3 步）
role: 销售
status: pending-review
generated_at: 2026-05-21T03:00:12Z
generated_by: dreaming-v2
evidence:
  source_employees: [yuxiang, lijun, wangtao]
  window: 2026-05-14..2026-05-21
steps:
  - id: confirm-terms
    name: 确认条款
    inputs: [客户ID]
    outputs: [terms-dict]
  - id: draft-v1
    name: 起草初稿
    inputs: [terms-dict]
    outputs: [contract-md]
  - id: legal-review
    name: 走审批
    inputs: [contract-md]
    outputs: [contract-pdf]
```

---

## 7. Pending-Skills 审批流

复用现有 skill marketplace 的形态（参考 commit `33a3e35`）：

```
pending-skills/
├── 销售/
│   ├── 销售合同起草-20260521.md
│   ├── 销售合同起草-20260521.yaml
│   └── 客户首次接触流程-20260521.{md,yaml}
└── 客服/
    └── ...
```

管理员在 Web 界面：
- 看到待审 SOP 列表（按 role 分组）
- 预览 SOP md + YAML
- 决定：**通过**（入哪一层：公司/小组/员工） / **打回** / **丢弃**
- 通过后由 skill 系统接管入仓 + 绑定可用员工

---

## 8. 模块草图（不实现，仅作未来参考）

```
src/dreaming/
├── index.ts            # DreamingScheduler — 注册 cron + 串联两阶段
├── phase1-employee.ts  # 单员工候选挖掘
├── phase2-role.ts      # 同角色合并 + 频次确认
├── llm-client.ts       # Anthropic SDK 直连封装
├── checkpoint.ts       # 增量水位线
└── output-writer.ts    # 写入 pending-skills/
```

**对外依赖**（已存在，无需新增）：
- `src/store.ts` MessageStore
- `src/scheduler.ts` 注册 cron 任务
- `src/config.ts` 配置加载

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 误判：把闲聊当 SOP | minRoleAgreement ≥ 2 频次门槛；人工审核兜底 |
| 单天数据噪声大 | 配置 N 天窗口；增量模式累积证据 |
| 多人风格差异：同一 SOP 难聚类 | Phase 2 用语义聚类而非字符串匹配 |
| 隐私敏感对话被采样 | dreaming 只读取 MessageStore；如有敏感字段过滤需求，在 Phase 1 入口处加 redactor |
| 性能开销大 | cron 离线；haiku 性价比；增量模式 |

---

## 10. 与现有架构的对接点

| 现有模块 | 对接方式 |
|----------|----------|
| MessageStore | 读取 `getMessagesSince(checkpoint)` |
| Scheduler | 注册 `type: 'cron'` 任务 |
| Knowledge Router | 不直接对接；pending-skills 通过后由 skill 系统决定知识落点 |
| Skill Marketplace | pending-skills 是其上游来源之一 |
| Three-tier Knowledge | dreaming 不决定层级，由审批人选择 |

---

## 11. 后续

本设计**暂不实施**。等待项目重构稳定后，按以下顺序落地：

1. 配置项落地 + 增量水位线
2. Phase 1 单员工挖掘
3. Phase 2 同角色合并
4. Pending-skills Web 审批界面
5. 与 skill marketplace 通过审批后的入仓打通

---

## 附录 A：与 v1（2026-05-19）对比

| 维度 | v1 记忆压缩 | v2 工作流挖掘（本文档） |
|------|-------------|-------------------------|
| 核心隐喻 | 浓缩长期记忆 | 还原工作步骤 |
| 输出 | 员工记忆条目 | 角色级 SOP + skill YAML |
| 落点 | 员工 memory store | pending-skills 待审区 |
| 自动化 | 全自动 | 半自动（人审） |
| 频次 | 不考虑 | 同角色 ≥K 人共现 |
| 现状 | 历史档案 | 当前生效设计 |
