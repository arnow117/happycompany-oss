# ADR-005: Runtime Profile for Worktree Isolation

**日期**: 2026-06-04
**状态**: 已采纳
**关联**: [ADR-003](./2026-05-21-003-dispatcher-as-router-fork-instances.md), [Platform Corp Directory Boundary](../specs/2026-05-30-corp-dir-platform-boundary.md)

## 背景

HappyCompany 支持通过 Git worktree 并行研发，但平台运行态不只存在于代码目录。默认 `config.json` 指向固定端口、`data/` 状态库以及 `../corp` 企业实例，多 worktree 共用时会互相污染消息库、合同库、员工 YAML、技能生成结果和真实 IM 连接。

## 决策

引入 runtime profile 作为代码 worktree 之外的运行隔离层：

- 后端启动支持 `--profile <name>` 与 `HAPPYCOMPANY_PROFILE=<name>`。
- profile 默认配置路径为 `.runtime/<name>/config.json`。
- profile 配置中的相对 `dataDir` 与 `corpDir` 以 `.runtime/<name>/` 为根解析。
- profile 配置省略 `dataDir` / `corpDir` 时默认使用 `.runtime/<name>/data` 与 `.runtime/<name>/corp`。
- 旧入口 `npx tsx src/index.ts` 与 `npx tsx src/index.ts config.e2e.json` 保持兼容。
- 前端 Vite 与 Playwright 支持 `HAPPYCOMPANY_WEB_PORT` / `HAPPYCOMPANY_API_PORT`，避免 worktree 并发研发时端口碰撞。

## 退化的内容

无。`config.json`、`config.e2e.json`、`HAPPYCOMPANY_CORP_DIR` 的既有路径解析仍保留。

## 保留的内容

`HAPPYCOMPANY_CORP_DIR` 仍保留最高优先级，用于生产和显式本机覆盖。profile 是开发隔离层，不替代生产部署中的 corp root 环境变量。

## 架构影响

| 模块 | 变更 |
|------|------|
| `src/runtime-config-profile.ts` | 新增 profile 解析、profile 默认目录和 config 路径解析 |
| `src/index.ts` | 启动时解析 runtime profile，并把 profile 默认目录应用到 `Config` |
| `web/vite.config.ts` | 前端端口和 API proxy 端口改为环境变量可配置 |
| `web/playwright.config.ts` | E2E 的 baseURL、webServer 端口和后端 config/profile 参数改为环境变量可配置 |
| `.gitignore` | 忽略本地 `.runtime/` profile 状态 |
