# E2E Journey Reporting Test Plan

**日期**: 2026-06-04
**状态**: 草案
**关联**: [E2E Journey Reporting Strategy](./2026-06-04-e2e-journey-reporting.md)

## 改动总览

为 Web E2E 增加“旅程报告模式”的组织规范、Playwright 配置入口和截图报告 helper，同时保留现有默认主线回归。

## 测试策略

| 层级 | 覆盖内容 | 验证命令 |
|------|----------|----------|
| 配置静态检查 | report config 可以被 Playwright 识别并列出用例 | `cd web && npm run test:e2e:report -- --list` |
| 默认主线回归 | 当前默认 E2E 不被新 report 配置影响 | `cd web && npm run test:e2e:mainline -- --list` |
| Helper 类型检查 | `web/e2e/reporting.ts` 不引入 `any`，可被 Playwright spec import | 由 Playwright list/运行时加载验证 |
| 文档一致性 | README、spec、package scripts 指向一致 | 人工审阅 |

## 新增用例/入口

1. `web/playwright.report.config.ts`
   - 输入：`npm run test:e2e:report -- --list`
   - 预期：列出 `journey-*` 用例，不改变默认 `playwright.config.ts`。

2. `web/e2e/reporting.ts`
   - 输入：Journey spec 调用 `createJourneyReport(testInfo, ...)`，再调用 `capture(...)`。
   - 预期：截图写入当前 test output，并作为 Playwright attachment 展示。

3. `web/e2e/README.md`
   - 输入：开发者阅读 E2E 目录。
   - 预期：能判断一个用例应放 Mainline、Journey、Probe 还是 Bug Replay，并知道过时 E2E 应更新或删除。

## 修改用例

本次不修改默认 Mainline 用例，避免把整理工作和行为回归混在一起。

## 删除用例

删除不再代表当前平台价值的旧 Story 和历史截图目录；不保留长期停放区。删除判断标准：

- 页面/路由已经消失。
- 流程已被当前 `/model-config`、`/employees`、`/agent-builder`、`/orchestration` 等新流程替代。
- 测试只验证旧实现细节或旧文案。
- 无法映射到当前用户价值。

## 验证命令

```bash
cd web
npm run test:e2e:mainline -- --list
npm run test:e2e:report -- --list
```

如需要完整验证：

```bash
cd web
npm run test:e2e:mainline
npm run test:e2e:report
```
