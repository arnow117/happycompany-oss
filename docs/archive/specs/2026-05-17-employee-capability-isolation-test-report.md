# 员工能力隔离测试报告

时间：2026-05-17 12:06:27 CST

## 背景

本轮清理针对 acme 老架构遗留问题：原先企业能力容易被混在一个工作目录或旧 `apps/*.yaml` 员工定义里。当前目标是把企业资产拆成两层：

- `corp/{tenant}/employees/*.yaml`：数字员工定义，声明角色、可见工具、可见 skills、可交接目标和流程职责。
- `corp/{tenant}/apps/{app}/`：工具包/工厂代码，提供 `tools.json`、`server.py` 或 CLI 能力。

## 本轮验证点

| 验证项 | 结果 |
| --- | --- |
| EmployeeLoader 只加载 `employees/*.yaml`，不再把旧 `apps/*.yaml` 当员工 | PASS |
| 编排执行 `AgentProtocol.execute()` 时注入员工自己的 `app-tools` MCP server | PASS |
| 编排执行时传入员工 YAML 声明的 `skills` | PASS |
| ToolRegistry 从 `apps/*/tools.json` 注册工具包 | PASS |
| acme `med_crm` 工具包可被扫描并展开为 9 个工具 | PASS |
| PMOOrchestratorRunner 路由到目标员工后，目标员工可用新注入路径执行 | PASS |
| demo seed 测试改为读取 `employees/sales-zhangsan.yaml` 等新路径 | PASS |
| 共享 fallback skills `human-invoice`、`human-acceptance` 存在 | PASS |

## 已执行命令

```bash
env VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run \
  tests/tool-registry.test.ts \
  tests/integration-tool-manifest.test.ts \
  tests/orchestrator/skill-bridge.test.ts \
  tests/orchestrator/employee-loader.test.ts \
  tests/orchestrator/employee-colony.test.ts \
  tests/demo-api.test.ts
```

结果：6 个测试文件通过，83 个测试通过。

```bash
env VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run \
  tests/orchestrator/orchestrator-runner.test.ts \
  tests/orchestrator/handoff-engine.test.ts \
  tests/orchestrator/handoff.test.ts
```

结果：3 个测试文件通过，20 个测试通过。

## 结论

当前代码已把“数字员工定义”和“工具包工厂代码”拆开：员工从 `employees/` 进入员工池，工具从 `apps/` 进入 ToolRegistry。编排器执行员工任务时，会按员工 YAML 注入对应 MCP tools 和 SDK skills，避免所有员工共享同一套能力。

## 后续建议

继续把外部老目录 `/workspace/corp/acme` 中的真实 `med_crm`、`device_procurement`、`device_knowledgebase` 迁移为 `corp/acme/apps/{app}` 下的工具包资产；本轮只补了 `med_crm` 的轻量 manifest 和 JSON-RPC 占位入口，用于保证平台能力边界和测试链路成立。`device_procurement`、`device_knowledgebase`、`service-record`、`workflow-runner` 仍是后续需要导入的工具/skill 包。
