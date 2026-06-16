# E2E Suite Run Report

**日期**: 2026-06-04
**运行时间**: 15:30 CST 左右
**范围**: 改造后的 Web E2E Mainline / Journey / Probe

## 总览

当前按目录口径共有 **20 个故事/路线**，合计 **57 条测试**。

| 套件 | 故事数 | 测试数 | 本次运行结果 | 运行命令 |
|------|--------|--------|--------------|----------|
| Mainline | 7 | 42 | 42 passed, 47.4s | `cd web && npm run test:e2e:mainline` |
| Journey | 6 | 6 | 6 passed, 12.1s | `cd web && npm run test:e2e:report` |
| Probe | 7 | 9 | 9 passed, 12.1s | `cd web && npm run test:e2e:probe` |

## 可查看的运行报告

- Mainline HTML: `web/playwright-report/index.html`
- Probe HTML: `web/playwright-report/probes/index.html`
- Journey HTML: `web/playwright-report/journeys/index.html`
- Product story HTML: `docs/reports/2026-06-04-e2e-story-review.html`
- Generated product story HTML: `docs/reports/2026-06-04-e2e-story-review.generated.html`
- Stable screenshot assets: `docs/reports/e2e-story-review-assets/`
- Generated Journey artifacts: `web/e2e/__journey-output__/`

## 故事清单

### 1. `story-bootstrap`

**类型**: Mainline
**测试数**: 9
**目的**: 验证首次配置/引导流程仍然通顺。

覆盖内容：

- 未配置系统展示 onboarding banner，并指向 `model-config`。
- `ModelConfig` 可以保存 API key。
- 模型配置完成后，banner 指向数字员工 setup。
- `/employee-network` 重定向到 `/employees`。
- `/employees` 是员工 setup 的当前 canonical 页面。
- 员工准备完成后，banner 指向 `/people`。
- `/people-binding` 重定向到 `/people`。
- 完全配置后隐藏 banner。
- dismiss banner 后写入 localStorage。

本次效果：全部通过，说明当前 setup 引导链路没有被整理工作破坏。

### 2. `story-config-page`

**类型**: Mainline
**测试数**: 7
**目的**: 验证 Config 页面核心配置能力和安全展示。

覆盖内容：

- Config 页面带 Web bot 可以正常加载。
- bot 列表显示正确 channel label。
- 凭证在列表中被 mask。
- Web 入口和 IM bot 管理分区展示。
- employee-director bot 显示 tenant 下拉。
- 飞书 bot 可以测试连接。
- bot form 可以配置 group reply mode。

本次效果：全部通过，说明 Config 页当前信息结构和关键交互仍可用。

### 3. `story-h-sessions`

**类型**: Mainline
**测试数**: 4
**目的**: 验证 Sessions 页面可以查看和清理运行时会话。

覆盖内容：

- 无 session 时展示空状态。
- session 列表展示 chat id 和 clear 按钮。
- clear session 后展示反馈。
- runtime filters 从 directory endpoints 填充。

本次效果：全部通过，说明会话列表、筛选和清理动作基本健康。

### 4. `story-q-chat-websocket`

**类型**: Mainline
**测试数**: 8
**目的**: 验证 Chat WebSocket 协议和前端流式展示。

覆盖内容：

- WebSocket 连接后显示 connected。
- 发送消息后，只在后端 `new_message` 到达时渲染。
- `stream_event` delta 渲染，final message 后清理 streaming block。
- handoff stream 先显示委派过程，再显示最终回复。
- bot 回复可展开 observability board。
- `new_message` error 渲染为 bot message。
- 断连后显示 disconnected，并支持 reconnect。
- 流式响应时显示 stop button。

本次效果：全部通过，说明 Chat 的协议层主线仍然稳定。

### 5. `story-v2-agent-builder-doc`

**类型**: Mainline / 截图型文档用例
**测试数**: 1
**目的**: 捕获 Agent Builder 迭代截图。

覆盖内容：

- Builder 空状态。
- draft structured editor。
- validation review。
- harness passed。
- runtime sandbox passed。
- publish confirm。
- publish success。

本次效果：通过。它更像文档截图生产用例，后续可以考虑迁到 Journey 报告层，避免 mainline 同时承担截图产物职责。

### 6. `story-v2-harness`

**类型**: Mainline
**测试数**: 1
**目的**: 验证验收 Harness 页面可以跑 suite 和单个 workflow step。

覆盖内容：

- Harness cases 加载。
- suite run 触发。
- 单 step run 触发。
- report/step result 展示。

本次效果：通过，说明验收页面主路径可用。

### 7. `story-v2-product-journey`

**类型**: Mainline
**测试数**: 12
**目的**: 验证当前 v2 产品核心链路。

覆盖内容：

- login guard 校验 admin token。
- 导航反映 runtime、employee、system 分层。
- Agent Builder 创建 draft，并通过 validation gates。
- Builder 支持 template 和 fork draft 来源。
- Builder 阻止过度授权 draft 发布。
- 修复 tool selection 后可以从 validation failure 恢复。
- onboarding 创建企业 tenant。
- employees 页面展示发布后的员工目录，并链接到 Builder。
- orchestration 页面展示 runtime collaboration logs。
- enterprise people 页面分配角色和个人 assistant。
- legacy entry routing URL 重定向到 Config。
- chat 页面支持企业入口两轮会话。

本次效果：全部通过，说明当前产品主旅程没有被 E2E 改造影响。

### 8. `journey-console-overview`

**类型**: Journey
**测试数**: 1
**目的**: 给 review 用的控制台概览截图报告样例。

覆盖内容：

- Dashboard 运行概览。
- Agent Builder 页面状态。
- 数字员工目录页面状态。

本次效果：通过，并生成 3 张截图和 journey summary。这个用例证明报告模式可以跑通，但它还是“概览型”，不是完整业务全链路。

### 9. `journey-employee-activation`

**类型**: Journey
**测试数**: 1
**目的**: 验证员工激活核心链路的关键状态可见。

覆盖内容：

- Builder 展示已发布销售数字员工。
- Employees 展示员工目录。
- People 展示企业员工与个人助手绑定。
- Chat 使用该数字员工完成业务对话。
- Sessions 展示运行记录和消息详情。

本次效果：通过，并生成 5 张截图和 journey summary。它是当前第一条真正跨页面的业务链路报告。

### 10. `probe-layout-shell`

**类型**: Probe
**测试数**: 2
**目的**: 探索全局壳层交互风险。

覆盖内容：

- 桌面侧栏折叠/展开。
- 租户切换。
- 主题切换。
- logout。
- 移动端打开/关闭菜单。

本次效果：全部通过，说明壳层按钮和移动菜单没有明显交互回归。

### 10A. `journey-chat-collaboration-handoff`

**类型**: Journey
**测试数**: 1
**目的**: 验证 Chat 中的销售到维修员工协作交接，并在运行看板和协同日志中复盘。

覆盖内容：

- Chat 选择销售数字员工并展示连接状态。
- handoff 处理中状态可见。
- 最终协同结果可见。
- 运行看板展示工具调用和 handoff。
- Orchestration 时间线展示用户消息、路由、handoff、工具调用和员工回复。

本次效果：通过，并生成 5 张截图。

### 10B. `journey-session-runtime-review`

**类型**: Journey
**测试数**: 1
**目的**: 验证 Sessions 能用于事后复盘运行会话，并回到对应 Chat 上下文。

覆盖内容：

- Sessions 列表展示运行会话。
- 按入口和发起人筛选。
- 展开会话查看消息详情。
- 通过 Chat 链接回到同一运行上下文。

本次效果：通过，并生成 4 张截图。

### 10C. `journey-harness-acceptance`

**类型**: Journey
**测试数**: 1
**目的**: 验证 Harness 页面能作为验收报告入口。

覆盖内容：

- Harness cases 和指标展示。
- Trace 报告展示 routing、tools、memory、handoffs。
- 运行当前企业用例。
- 运行长任务 StepRun。

本次效果：通过，并生成 4 张截图。

### 10D. `journey-multi-tenant-isolation`

**类型**: Journey
**测试数**: 1
**目的**: 验证租户切换后 Sessions 和 Orchestration 不串数据。

覆盖内容：

- 主企业可见运行会话。
- 切到 `acme-demo` 后 Sessions 为空。
- `acme-demo` 的 Orchestration 无主企业协同日志。
- 切回主企业后数据恢复。

本次效果：通过，并生成 4 张截图。

### 11. `probe-knowledge-interactions`

**类型**: Probe
**测试数**: 1
**目的**: 探索知识库 tab 和删除弹窗风险。

覆盖内容：

- 三层知识库 tab 过滤。
- 删除弹窗打开。
- ESC 取消。
- Cancel 取消。
- Confirm 删除后展示 `Deleted` 反馈。

本次效果：通过，说明当前知识库交互的弹窗取消/确认路径可用。

### 12. `probe-memory-editor`

**类型**: Probe
**测试数**: 1
**目的**: 探索 Memory 编辑器交互风险。

覆盖内容：

- 对象切换。
- 搜索和清除。
- 打开 memory 文件。
- 编辑后取消恢复原内容。
- 编辑后保存并展示 `Saved`。
- 返回列表。

本次效果：通过。运行中发现页面对象 selector 没有可访问 label，测试改成 `main select` 定位；这是一个后续可改进的可访问性点。

### 13. `probe-config-editing`

**类型**: Probe
**测试数**: 1
**目的**: 探索配置页密钥展示、连接测试和 Web Chat 文案保存风险。

覆盖内容：

- masked token reveal。
- 模型连接测试。
- Web Chat 输入提示编辑和保存。

本次效果：通过，说明 Config 的关键编辑入口可用。

### 14. `probe-enterprise-people-binding`

**类型**: Probe
**测试数**: 1
**目的**: 探索企业员工角色和个人助手绑定交互。

覆盖内容：

- 同步通讯录。
- 分配角色。
- 绑定个人助手。

本次效果：通过，说明 People 页的核心绑定交互可用。

### 15. `probe-skill-marketplace-package`

**类型**: Probe
**测试数**: 2
**目的**: 探索技能市场租户技能包展示和 legacy app query 兼容。

覆盖内容：

- 租户 skill package 元数据展示。
- 过滤 global skills。
- legacy app query 聚焦匹配技能包。

本次效果：通过。该 probe 来自当前工作区已有改动，本报告纳入统计。

## 运行后的结论

这套改造后已经完整跑过：

- 默认主线没有被 Probe/Journey 污染，仍然是 42 条。
- Journey 报告模式可生成截图和 summary，当前有控制台概览、员工激活、聊天协作交接、会话复盘、Harness 验收、多租户隔离 6 条。
- Probe 层可以承接按钮、弹窗、编辑器、配置、绑定、协同日志、技能包这类“手点发现 bug”的交互面。
- 当前总量是 20 个故事/路线，57 条测试，全部通过。
- 产品故事报告可手工维护，也可以通过 `npm run e2e:story-report` 自动生成骨架。

## 我建议的 Review 重点

1. `story-v2-agent-builder-doc` 是否应该从 Mainline 迁到 Journey。
2. `journey-employee-activation` 是否需要从“关键状态可见”加深到“真实点击发布”。
3. Probe 是否要在每个前端需求迭代后按需新增/删除。
4. Journey 报告是否继续复制稳定截图到 `docs/reports/*-assets/`。
5. Memory/Sessions 页面 select 缺少可访问 label，是否顺手补可访问性。
