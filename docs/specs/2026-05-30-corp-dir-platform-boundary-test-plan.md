# Corp Directory Boundary Test Plan

**日期**: 2026-05-30
**范围**: 平台 corp root 显式配置、FDE 脚手架、部署文档

## 改动总览

平台支持通过 `HAPPYCOMPANY_CORP_DIR` 或 `config.json.corpDir` 指定企业实例与模板根目录，替代只依赖仓库内 `corp/` 的隐式行为。

## 测试策略

- 单元测试：覆盖 corp root 解析优先级和配置加载。
- CLI smoke：覆盖 `fde:new --help` 显示当前 corp root。
- 回归测试：跑全量 TypeScript、Vitest、前端 build、Playwright E2E。

## 新增/修改用例

| 用例 | 输入 | 预期 |
|------|------|------|
| env 优先 | 设置 `HAPPYCOMPANY_CORP_DIR` 且传入 config corpDir | 返回 env 路径 |
| config 次优先 | 未设置 env，传入 config corpDir | 返回 config 路径 |
| 未解析占位符 | `corpDir="$HAPPYCOMPANY_CORP_DIR"` 且 env 未设置 | 忽略占位符，回退自动探测 |
| 配置加载 | config 中 `corpDir="$HAPPYCOMPANY_CORP_DIR"` 且 env 已设置 | `loadConfig()` 返回展开后的路径 |
| FDE help | `npm run fde:new -- --help` | 输出 `--corp-dir` 选项和可用模板 |

## 验证命令

```bash
npx tsc --noEmit
env VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/index-corp-dir.test.ts tests/config.test.ts
npm run fde:new -- --help
cd web && npm run typecheck -- --noEmit
cd web && npm run build
npx vitest run
cd web && npx playwright test
```
