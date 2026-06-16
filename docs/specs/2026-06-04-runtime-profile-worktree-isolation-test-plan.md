# Runtime Profile Worktree Isolation Test Plan

**日期**: 2026-06-04

## 改动总览

新增 runtime profile 层，让每个 worktree 可以使用独立 config、`dataDir`、`corpDir`、后端端口、前端端口和 E2E 入口。

## 测试策略

单元测试覆盖 profile 解析和目录默认值；TypeScript 检查覆盖后端、Vite 和 Playwright 配置类型；构建验证前端配置仍可编译。

## 新增用例

| 用例 | 输入 | 预期 |
|------|------|------|
| 默认启动兼容 | 无参数 | 仍读取仓库根 `config.json` |
| 旧 positional config 兼容 | `config.e2e.json` | 作为显式 config 路径读取 |
| profile 路径解析 | `--profile feat-builder` | config 路径为 `.runtime/feat-builder/config.json` |
| env profile 解析 | `HAPPYCOMPANY_PROFILE=feat-a` | 使用 `.runtime/feat-a/config.json` |
| 显式 config 优先 | `HAPPYCOMPANY_PROFILE` + `HAPPYCOMPANY_CONFIG` | 使用显式 config，保留 profile 名用于日志 |
| profile 名校验 | `--profile ../prod` | 拒绝越界 profile 名 |
| profile 默认 dataDir/corpDir | profile config 省略目录 | 使用 `.runtime/<name>/data` 和 `.runtime/<name>/corp` |
| profile 相对路径 | `dataDir: "state"` | 解析到 `.runtime/<name>/state` |

## 修改用例

无既有断言需要删除。`tests/config.test.ts` 继续覆盖原始 config schema 和 env expansion。

## 删除用例

无。

## 验证命令

```bash
npx vitest run tests/runtime-profile.test.ts tests/config.test.ts
npm run typecheck
cd web && npm run typecheck && npm run build
```

前端页面行为未改变，本次不新增页面级 E2E。worktree 并发 E2E 可通过以下方式手动 smoke：

```bash
cd web && HAPPYCOMPANY_PROFILE=feat-builder \
  HAPPYCOMPANY_WEB_PORT=8891 \
  HAPPYCOMPANY_API_PORT=3101 \
  npx playwright test
```
