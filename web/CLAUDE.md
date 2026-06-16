# web/ — Frontend (React SPA)

> Inherits from /CLAUDE.md. Rules here ADD to root, never contradict.

## Commands (scoped to frontend)

```bash
just web check       # tsc + vite build (~5s)
just web pre-pr      # tsc + build + vitest (~15s)
just web build       # vite build only
just web typecheck   # tsc -b
just web dev         # vite dev server on 8888
```

Worktree profile 调试时不要临时换命令，使用同一套 env 偏移端口：

```bash
HAPPYCOMPANY_WEB_PORT=8891 HAPPYCOMPANY_API_PORT=3101 npm run dev
```

## Architecture

- **State**: Zustand (web/src/stores/)。一个 store (chat.ts)。
- **API client**: web/src/lib/api.ts — 所有后端调用集中在此。
- **Pages**: 18 页面在 web/src/pages/，每页一个 .tsx。
- **Styles**: tokens.css (design tokens) + global.css，无 CSS-in-JS。

## Prohibitions

| # | 禁止 | Rationale: 为什么 |
|---|------|-------------------|
| W1 | Zustand selector 不返回每次新建的引用 | `filter()`、展开运算符在 selector 中导致无限重渲染。派生数据用 `useMemo`，selector 只取原始值 |
| W2 | 不在 pages/ 中直接 fetch 后端 | 所有 API 调用走 lib/api.ts，确保 URL 和 auth header 一致 |
| W3 | 不用临时端口启动 Vite | 默认端口是 8888；worktree 并行研发必须用 `HAPPYCOMPANY_WEB_PORT`，并同步 `HAPPYCOMPANY_API_PORT` |

## Self-Check Triggers

- **"新建一个 Zustand store"** → 当前只有 chat.ts 一个 store。确定需要新建还是扩展现有的？
- **"在组件里直接写 API URL"** → 走 lib/api.ts。
- **"用 `.filter()` 做 Zustand selector"** → 改用 `useMemo` 在组件内派生。
- **"端口被占用，换个 Vite port"** → 使用 runtime profile 的成对端口 env，不要只改前端端口。

## Debugging Workflow

前端改动后 **必须 build + 重启后端** 才能在 3100 端口验证。后端 serve `web/dist/` 静态文件。

```
1. Vite dev server (8888) + fresh browser context → 可读错误
2. 定位根因 → 修复代码
3. just web check → 编译通过
4. 重启后端 → 加载新 dist
5. fresh browser context 测试 3100 → 验证
```

## Testing

- 单元测试: `cd web && npx vitest run`
- E2E 测试: `cd web && npx playwright test`
- E2E 位于 `web/e2e/`，按场景分目录
