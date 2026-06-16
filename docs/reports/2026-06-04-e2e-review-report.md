# E2E Review Report

**日期**: 2026-06-04
**状态**: Review 草案
**范围**: Web E2E 分层整理、Journey 报告模式、Probe 交互实例

## 你可以在哪里 Review

### 1. 设计策略

- `docs/specs/2026-06-04-e2e-journey-reporting.md`
- `docs/specs/2026-06-04-e2e-journey-reporting-test-plan.md`

这里看的是“为什么这么分层”：Mainline、Journey、Probe、Bug Replay，以及需求迭代后如何 Add / Update / Delete / Reclassify。

### 2. 工程沉淀

- `.codex/skills/happycompany-e2e/SKILL.md`
- `web/e2e/README.md`
- `web/playwright.config.ts`
- `web/playwright.report.config.ts`
- `web/playwright.probe.config.ts`

这里看的是“以后怎么照着做”：新增、删除、改造 E2E 时应该放在哪一层，用什么命令跑。

### 3. 可运行报告

- `web/playwright-report/probes/index.html`
- `web/playwright-report/index.html`
- `web/e2e/__journey-output__/journey-console-overview-j-ae943-es-console-overview-journey-chromium/journey-console-overview/summary.md`

这里看的是“跑出来长什么样”：Probe 的 HTML 测试报告，以及 Journey 的截图和 summary。

## 当前设计结论

当前 E2E 被整理成四层：

| 层级 | 作用 | 是否进入默认回归 | 当前状态 |
|------|------|------------------|----------|
| Mainline | 平台主线是否健康 | 是 | 42 条，7 个文件 |
| Journey | 功能/迭代/全链路带截图报告 | 否 | 已有 `journey-console-overview` 样例 |
| Probe | 按钮、表单、弹窗、筛选、边界状态探索 | 否 | 新增 3 组，4 条 |
| Bug Replay | 真实 bug 最小复现 | 否，先作为 Probe | 规则已沉淀 |

我认为这个边界目前是合理的：默认 E2E 不变胖，报告模式可以给迭代验收看截图，Probe 承接“手点时发现问题”的交互风险。

## 当前 Mainline

命令：

```bash
cd web
npm run test:e2e:mainline -- --list
```

结果：

- 42 tests
- 7 files
- 覆盖 `story-bootstrap`、`story-config-page`、`story-h-sessions`、`story-q-chat-websocket`、`story-v2-*`

Review 重点：

- 这些用例是否仍然代表当前平台核心主线？
- 哪些 story 已经过于宽泛，应该拆成 Journey？
- 哪些交互只是页面细节，不应该阻塞日常开发？

## 当前 Journey

命令：

```bash
cd web
npm run test:e2e:report
```

当前样例：

- `web/e2e/journey-console-overview/journey.spec.ts`

截图附件：

- `web/e2e/__journey-output__/journey-console-overview-j-ae943-es-console-overview-journey-chromium/journey-console-overview/01-dashboard.png`
- `web/e2e/__journey-output__/journey-console-overview-j-ae943-es-console-overview-journey-chromium/journey-console-overview/02-agent-builder.png`
- `web/e2e/__journey-output__/journey-console-overview-j-ae943-es-console-overview-journey-chromium/journey-console-overview/03-employees.png`

Review 重点：

- 截图是否足够表达一次“控制台概览”？
- Journey 是否应该从当前概览，升级为“员工创建到运行”的完整链路？
- Journey 的 mock 是否需要标清，避免误以为是真实后端数据？

## 当前 Probe

命令：

```bash
cd web
npm run test:e2e:probe
```

验证结果：

- 4 passed
- 3 files

当前实例：

| Probe | 覆盖交互 | 目的 |
|-------|----------|------|
| `probe-layout-shell` | 侧栏折叠、租户切换、主题切换、登出、移动端菜单 | 覆盖全局壳层按钮和导航风险 |
| `probe-knowledge-interactions` | 分层 tab、删除弹窗 ESC/Cancel/Confirm | 覆盖弹窗和筛选类风险 |
| `probe-memory-editor` | 对象切换、搜索/清除、打开文件、编辑/取消/保存/返回 | 覆盖编辑器和状态恢复风险 |

Review 重点：

- 这些 Probe 是否代表你说的“有时候点某个按钮发现 bug”的风险面？
- Probe 是否应该保留为长期探索实例，还是只在相关迭代时跑？
- 下一批应该补 `EnterprisePeople` 绑定、`Config` 编辑，还是 `Orchestration` 筛选？

## 我建议你重点看这 5 个问题

1. Mainline 现在 42 条是否过多，还是刚好？
2. `story-v2-product-journey` 是否应该拆一部分到 Journey 报告？
3. Probe 要不要成为每次前端迭代后的可选 checklist？
4. Journey 截图报告是不是你想给产品/业务 review 的形态？
5. 删除历史无效 E2E 的边界是否 OK：过时就删，不做回档停放区。

## 当前我建议的下一步

1. 保留当前 v1 分层。
2. 下一轮补两个 Probe：
   - `probe-enterprise-people-binding`
   - `probe-config-editing`
3. 再做一个真正的全链路 Journey：
   - `journey-employee-activation`
   - 路线：Agent Builder -> Employees -> People -> Chat -> Sessions/Orchestration
4. 每次需求迭代结束时，按 Add / Update / Delete / Reclassify 审一次 E2E。
