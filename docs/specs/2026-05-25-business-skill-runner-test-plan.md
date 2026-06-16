# 业务 Skill Runner 与 MCP 边界收敛测试方案

> 日期: 2026-05-25
> 状态: 草案
> 关联需求: [业务 Skill Runner 与 MCP 边界收敛需求](./2026-05-25-business-skill-runner-requirements.md)

## 改动总览

业务员工不再直接注入租户业务 MCP tools，改为通过受控 Skill Runner 调用绑定 skill 内的 executable/CLI；平台 MCP 保持可用。

## 测试策略

| 层级 | 目标 |
|---|---|
| 单元测试 | Skill Runner 校验、权限、command 解析、错误返回 |
| 集成测试 | EmployeeManager 运行时工具注入边界、AuthGate + ToolRegistry + AppServerMgr 串联 |
| 配置测试 | 示例医疗员工 YAML 不存在 skill、悬空 target、不可用模型检测 |
| IM loop | 本地 WebSocket 模拟钉钉消息端到端 |
| 真实验收 | 钉钉真实消息链路 |

## 新增用例

### T1. Skill Runner 允许授权 read command

输入：

- employeeId: `sales-zhangsan`
- skill: `med_crm`
- command: `global_search`
- args: `{ "keyword": "今天重点客户" }`

预期：

- 校验员工绑定 `med_crm`。
- 校验 command 存在。
- `AuthGate` 允许。
- 调用 AppServerMgr。
- 返回结构化结果。

### T2. Skill Runner 拒绝未绑定 skill

输入：

- employeeId: `sales-zhangsan`
- skill: `finance`
- command: `write_invoice`

预期：

- 拒绝于员工 skill 绑定校验。
- 不调用 AppServerMgr。

### T3. Skill Runner 拒绝越权 command

输入：

- employeeId: `sales-zhangsan`
- skill: `med_crm`
- command: `write_invoice`

预期：

- command 若存在但角色无权，`AuthGate` 拒绝。
- 返回权限原因。
- 不执行 CLI/server。

### T4. EmployeeManager 不注入业务 MCP

预期：

- 员工执行时不注入 `app-tools:<employee-id>` 业务 MCP tools。
- 保留平台 handoff/协调工具。
- 不暴露 `Bash`、`Read`、`Grep`、`Glob`。

### T5. 平台 MCP handoff 仍可用

输入：

- 销售员工触发合同签署后 handoff 给维修李四。

预期：

- handoff 工具可调用。
- 编排器收到 handoff。
- 业务 MCP 收敛不影响平台协调 MCP。

### T6. 示例医疗配置卫生检查

检查：

- 所有 `skills` 都存在于 `corp/acme/.claude/skills/` 或对应 app skill。
- 所有 `allowedTargets` 都存在于 `corp/acme/employees/*.yaml`。
- 不存在 `device_procurement`、`workflow-runner`、`device_knowledgebase`、`service-record` 等未安装旧 skill。
- 员工模型为当前可用模型或空字符串继承全局。

### T7. 本地 IM loop 验收

命令：

```bash
node scripts/im-loop.mjs --user 131537090028023523 --chat local-im-sales-skill-runner --timeout 120000 --seq '/list|10|查一下今天有什么重点客户要跟进'
```

预期：

- 返回员工列表。
- 数字选择成功切换员工。
- 业务问题触发 Skill Runner。
- 返回真实业务摘要。
- PM2 日志中没有 Bash 探环境或业务 MCP 权限错误。

### T8. 钉钉真实链路验收

用户在钉钉发送：

```text
/list
10
查一下今天有什么重点客户要跟进
```

预期：

- 与本地 IM loop 行为一致。
- 发送成功。
- 不反复回到员工选择器。

## 修改用例

- `tests/orchestrator/skill-bridge.test.ts`：不再断言业务工具被构造成员工可见 MCP；改为断言工具注册/解析服务于 Skill Runner。
- `tests/orchestrator/employee-colony.test.ts`：断言员工运行时隐藏业务 MCP 和 Bash，保留平台协调能力。
- `tests/enterprise-tool-policy.test.ts`：权限主路径改为结构化 skill command；Bash 解析仅作为兼容层。
- `tests/orchestrator/employee-e2e.test.ts`：样例 YAML 必须来自当前仓库 `corp/acme/employees/`。

## 验证命令

```bash
npm run typecheck
npx vitest run tests/enterprise-tool-policy.test.ts tests/orchestrator/employee-colony.test.ts tests/orchestrator/skill-bridge.test.ts tests/orchestrator/employee-e2e.test.ts
node scripts/im-loop.mjs --user 131537090028023523 --chat local-im-sales-skill-runner --timeout 120000 --seq '/list|10|查一下今天有什么重点客户要跟进'
```

如涉及前端配置页变更，追加：

```bash
cd web && npm run test -- --run
cd web && npm run build
cd web && npx playwright test
```

## Done 标准

- 需求文档中的 R1-R7 均实现。
- T1-T8 均通过或有明确人工验收记录。
- 业务员工日志不再出现通用 Bash 探环境。
- 平台 MCP handoff 不受影响。
- 示例医疗销售张三真实 IM 链路可稳定返回业务结果。
