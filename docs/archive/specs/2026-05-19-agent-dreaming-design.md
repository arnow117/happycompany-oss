# Agent Dreaming — Self-Improving Memory Consolidation

> ADR-004 · 2026-05-19

## 一句话

当 agent 不在执行任务时，它回看自己的 session 历史，用 LLM 整理记忆：修正矛盾、修剪过时、提炼模式、建议优化。像人睡觉做梦一样。

## 动机

### 为什么需要 Dreaming

Agent 每次对话都是无状态的 — systemPrompt + session context。随着使用积累：

- **重复犯错** — 同样的错误在不同 session 反复出现
- **记忆腐化** — 早期存的知识不再准确，但从未被清理
- **知识碎片** — 每次学一点，从不整合
- **无法进化** — agent 运行三个月和第一天能力一样

人脑通过睡眠解决这个问题 — REM 睡眠时回放白天经历，巩固有用的，修剪无用的。Agent 可以做同样的事。

### 行业趋势

Anthropic 在 2026 年 5 月 Code with Claude 大会正式发布 "Claude Dreaming"：
- 回放 agent 过去 session
- 提取模式，修正记忆
- Harvey（法律 AI）实测 6x 任务完成率提升
- 独立实验 5.4x 完成率、3.1x token 节省

HermesAgent 社区也在请求 [Auto-Dream 功能](https://github.com/NousResearch/hermes-agent/issues/10771)。

### HappyCompany 的独特优势

| 优势 | 说明 |
|------|------|
| **租户隔离** | 不同企业的 agent 各自 dream，数据不混 |
| **跨 agent 共享** | 同角色的 agent 可以合并 dream 发现 |
| **从 dream 提炼 eval** | 发现的错误模式可以自动生成测试 |
| **企业审核** | 敏感场景下，dream 结果需要管理员审批 |
| **与 scheduler 集成** | 已有 cron 调度基础设施 |

---

## 架构设计

### 整体流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Dreaming Pipeline                        │
│                                                             │
│  scheduler.ts (cron "0 3 * * *")                            │
│    │                                                        │
│    ▼                                                        │
│  DreamRunner                                                │
│    │  foreach employee in tenant                            │
│    │                                                        │
│    ├── 1. Collect ──────────────────────────────────────┐   │
│    │   读近 N 个 .session-*.json                         │   │
│    │   读当前 knowledge.json                             │   │
│    │                                                     │   │
│    ├── 2. Analyze ──────────────────────────────────────┤   │
│    │   LLM 分析 session + knowledge                     │   │
│    │   输出：adds / updates / deletes / patterns         │   │
│    │                                                     │   │
│    ├── 3. Restructure ─────────────────────────────────┤   │
│    │   应用 memory 更新                                  │   │
│    │   写入 knowledge.json                              │   │
│    │                                                     │   │
│    ├── 4. Report ──────────────────────────────────────┤   │
│    │   生成 dream-report.json                           │   │
│    │   可选：通知管理员审核                              │   │
│    │                                                     │   │
│    └── 5. Cross-Agent (v2) ───────────────────────────┘   │
│        同角色 agent 的 dream 结果合并                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
输入                               处理                        输出
─────                              ─────                       ─────

.session-*.json (近N个)  ──┐
                           ├──▶  Claude (haiku)  ──▶  knowledge.json (更新)
knowledge.json (当前)     ──┘        分析             dream-report.json (日志)
                                                      prompt-suggestions.json (可选)
```

### 文件结构

```
corp/{tenant}/
├── agents/{employee}/
│   ├── .session-*.json          ← 输入：session 历史（已有）
│   ├── knowledge.json           ← 新增：agent 长期记忆
│   └── dream-report.json        ← 新增：dreaming 日志
├── employees/{employee}.yaml    ← 可选：dreaming 可建议 prompt 优化
└── dream-config.json            ← 新增：租户级 dreaming 配置
```

---

## 核心组件

### 1. DreamRunner (src/orchestrator/dream-runner.ts)

```typescript
interface DreamConfig {
  enabled: boolean
  schedule: string              // cron expression, e.g. "0 3 * * *"
  sessionLimit: number          // 回看最近 N 个 session，默认 20
  model: string                 // dreaming 使用的模型，默认 claude-haiku-4-5
  reviewMode: 'auto' | 'manual' // auto=自动提交, manual=需审核
  crossAgent: boolean           // v2: 是否跨 agent 合并发现
}

interface DreamResult {
  employeeId: string
  adds: MemoryEntry[]
  updates: MemoryUpdate[]
  deletes: string[]             // entry IDs to delete
  patterns: string[]
  promptSuggestions: string[]
  tokenUsage: { input: number, output: number }
}
```

### 2. DreamAnalyzer (src/orchestrator/dream-analyzer.ts)

负责构造 LLM prompt 并解析输出。

### 3. DreamStore (src/orchestrator/dream-store.ts)

Knowledge 的读写层。

```typescript
interface KnowledgeEntry {
  id: string
  topic: string
  content: string
  source: 'session' | 'dream' | 'manual'
  createdAt: number
  updatedAt: number
  accessCount: number        // 被检索次数
  lastAccessedAt: number
}

interface KnowledgeStore {
  entries: KnowledgeEntry[]
  version: number
  lastDreamAt: number | null
}
```

### 4. 与 Scheduler 集成

在 employee YAML 中新增 dream 配置：

```yaml
dream:
  enabled: true
  schedule: "0 3 * * *"
  sessionLimit: 20
  model: "claude-haiku-4-5"
  reviewMode: "auto"
```

或者租户级配置 `dream-config.json`：

```json
{
  "enabled": true,
  "schedule": "0 3 * * *",
  "employees": {
    "sales-zhangsan": {
      "enabled": true,
      "sessionLimit": 30
    },
    "finance-wangwu": {
      "enabled": true,
      "reviewMode": "manual"
    }
  }
}
```

---

## Dreaming Prompt 设计

### 分析 Prompt

```
你是数字员工 {displayName} 的记忆整理助手。

## 员工角色
{employee.systemPrompt 前 500 字}

## 近期 Session 记录
{session_logs，每个 session 摘要化到 200 字以内}

## 当前知识库
{knowledge.json 的 entries}

## 分析任务

### A. 错误模式（error_patterns）
找出反复出现的错误或低效行为。
每个模式需要至少 2 次出现才报告。

### B. 成功策略（success_strategies）
找出值得记住的成功做法。
重点关注：被用户认可的回复、高效完成的任务。

### C. 知识库维护（knowledge_updates）
检查当前知识库：
- 是否有过时条目？
- 是否有矛盾条目？
- 是否有从未使用的条目？（accessCount = 0 且超过 7 天）

### D. 泛化模式（generalized_patterns）
从具体 session 中提炼通用规则。

### E. Prompt 优化建议（prompt_suggestions）
基于发现的模式，建议如何改进 systemPrompt。

## 输出 JSON 格式
{
  "error_patterns": [{ "pattern": "...", "sessions": [id1, id2], "suggestion": "..." }],
  "success_strategies": [{ "strategy": "...", "sessions": [id1, id2], "memory_entry": "..." }],
  "knowledge_updates": {
    "adds": [{ "topic": "...", "content": "..." }],
    "updates": [{ "id": "...", "content": "...", "reason": "..." }],
    "deletes": [{ "id": "...", "reason": "..." }]
  },
  "generalized_patterns": ["..."],
  "prompt_suggestions": ["..."]
}
```

---

## 实现分期

### Phase 1: 基础 Dreaming（MVP）

**目标：** 单个 agent 回看自己的 session，整理 knowledge。

- [ ] `src/orchestrator/dream-runner.ts` — 主逻辑
- [ ] `src/orchestrator/dream-analyzer.ts` — LLM prompt + 输出解析
- [ ] `src/orchestrator/dream-store.ts` — knowledge.json 读写
- [ ] 与 `scheduler.ts` 集成 — 注册 dream 定时任务
- [ ] `knowledge.json` 注入到 agent session — 作为 systemPrompt 的一部分
- [ ] 基础 dream report — JSON 格式日志

**验证标准：**
- 手动触发 dream，能生成合理的 knowledge 更新
- 更新后的 knowledge 在下次 session 中生效
- dream report 可读、可追溯

### Phase 2: 企业级控制

**目标：** 审核流、租户配置、admin API。

- [ ] `dream-config.json` 租户级配置
- [ ] Admin API: 查看 dream report、审批 pending 更新
- [ ] Admin Dashboard: dreaming 历史和统计
- [ ] Review mode — manual 模式下 pending 状态
- [ ] Dreaming 触发方式扩展：手动触发、空闲触发

### Phase 3: 跨 Agent 共享

**目标：** 同角色 agent 合并 dream 发现，提炼角色级知识。

- [ ] 同角色 dream 结果合并（如两个 sales agent 的发现）
- [ ] 角色级 knowledge（`corp/{tenant}/roles/sales/knowledge.json`）
- [ ] 从 dream 结果自动生成 eval 测试用例
- [ ] Dreaming 建议的 prompt 优化 → 管理员审批 → 自动更新 employee YAML

### Phase 4: 自进化闭环

**目标：** Agent 持续进化，自动优化。

- [ ] Dream → Eval → Apply 循环
- [ ] 基于 eval 结果决定是否采纳 dream 建议
- [ ] A/B 测试：旧 prompt vs 新 prompt
- [ ] 长期趋势追踪：agent 能力随时间的变化曲线

---

## Knowledge 注入方式

Dreaming 产生的 knowledge 需要在 agent 的下次 session 中生效。

### 方案 A：注入到 systemPrompt（推荐 Phase 1）

在 `employee-colony.ts` 的 `AgentAdapter` 构造 systemPrompt 时，
从 `knowledge.json` 读取条目，追加到 prompt 末尾。

```
{原始 systemPrompt}

## 长期记忆
{knowledge entries 格式化为 markdown}
```

### 方案 B：通过 MCP 工具检索（Phase 2+）

注册一个 `knowledge_search` MCP 工具，agent 可以主动查询自己的知识库。
好处是减少 prompt 长度，缺点是增加一次 tool call。

### 方案 C：混合（Phase 3+）

高频知识注入 prompt，低频知识通过 MCP 按需检索。

---

## 安全与边界

| 风险 | 缓解措施 |
|------|---------|
| Dream 产生错误知识 | 至少 2 次出现才报告；manual 模式需审核 |
| 删除重要知识 | dream 不能删除 `source: manual` 的条目 |
| Token 消耗 | 使用 haiku 模型；限制 session 回看数量 |
| 跨租户数据泄露 | dream 严格按 tenant 隔离，不跨租户读取 |
| Prompt 注入 | session 摘要化时过滤敏感内容 |

---

## 测试策略

### 单元测试

- DreamAnalyzer: prompt 构造、输出解析（mock LLM）
- DreamStore: knowledge CRUD、版本管理
- DreamRunner: orchestration 逻辑

### 集成测试

- 端到端 dream 流程：session 文件 → 分析 → knowledge 更新
- Knowledge 注入：验证更新后的 knowledge 出现在 agent prompt 中
- Review mode：验证 manual 模式下 pending 状态

### 评估测试

- 准备一组有已知模式的 session
- 验证 dream 能发现这些模式
- 验证 knowledge 更新后 agent 在类似任务上表现改善

---

## 参考资料

- [What Is Claude Dreaming? — MindStudio](https://www.mindstudio.ai/blog/what-is-claude-dreaming-anthropic-agent-memory/)
- [I Let Claude Dream for 4 Hours — Towards AI](https://pub.towardsai.net/i-let-claude-dream-for-4-hours-todays-agent-just-killed-yesterdays-by-5-4-on-18-repeat-tasks-0d09741fe6f1)
- [HermesAgent Auto-Dream Feature Request](https://github.com/NousResearch/hermes-agent/issues/10771)
- [Long Term Memory: Foundation of AI Self-Evolution — arXiv](https://arxiv.org/html/2410.15665v1)
- [Teaching Alfred to Remember — dev.to](https://dev.to/joojodontoh/teaching-alfred-to-remember-with-a-neuroscience-inspired-memory-system-for-ai-agents-2o5l)
- [The Architecture of Forgetting](https://nicolevanderhoeven.com/blog/20260507-architecture-of-forgetting/)
