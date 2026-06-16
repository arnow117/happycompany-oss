# Operations Guide

> 从 CLAUDE.md 抽离的运维和部署操作手册。

## PM2 进程管理

日常开发不需要 PM2，直接 `npm run dev` 即可。在需要常驻运行的场景下使用：

```bash
# 测试环境（关终端不丢进程）
pm2 start "npm run dev" --name happycompany

# 生产环境（推荐写 ecosystem 配置）
pm2 start ecosystem.config.cjs

# 常用命令
pm2 logs happycompany    # 查看日志
pm2 monit                 # 监控 CPU/内存
pm2 restart happycompany  # 重启
pm2 stop happycompany     # 停止
```

## 部署流程

生产环境必须先配置环境变量：

```bash
export NODE_ENV=production
export HAPPYCOMPANY_ADMIN_TOKEN="$(openssl rand -hex 32)"
export HAPPYCOMPANY_CORP_DIR="/srv/happycompany/corp"
export ACME_DINGTALK_CLIENT_ID="..."
export ACME_DINGTALK_CLIENT_SECRET="..."
```

生产启动时如果没有有效 `HAPPYCOMPANY_ADMIN_TOKEN`，服务会拒绝启动。企业凭证必须使用环境变量或加密配置，不能以明文写入 `config.json`。

`HAPPYCOMPANY_CORP_DIR` 是平台与企业实例的文件边界：平台代码从这里扫描企业租户与行业模板。目录内约定如下：

```text
/srv/happycompany/corp/
├── templates/                  # 平台维护的行业模板，可随版本发布
│   └── industries/
└── {tenant}/                    # 企业实例，本地/客户私有仓库维护
    ├── app.json
    ├── roles.json
    ├── people.json
    ├── employees/
    ├── agents/
    ├── apps/
    ├── workflows/
    └── processes/
```

解析优先级：`HAPPYCOMPANY_CORP_DIR` > `config.json.corpDir` > 仓库内 `corp/` > 上级 `../corp` 兼容路径。生产环境建议显式设置 `HAPPYCOMPANY_CORP_DIR`，不要依赖自动探测。

### 当前本机数据目录

当前开发机的 `config.json` 使用：

```json
{
  "corpDir": "../corp"
}
```

实际扫描目录是：

```text
/workspace/corp/
```

当前 HappyCompany 运行实例使用的示例医疗租户是 `acme-happycompany`：

```text
../corp/acme-happycompany/
```

注意：上层已有 `../corp/acme/`，这是另一份历史/独立示例医疗目录，不要覆盖；`config.json` 里的 `web-bot` 和 `acme-dingtalk` 应保持 `tenant: "acme-happycompany"`。

主仓内只保留平台模板源：

```text
happycompany/corp/templates/
```

平台状态数据仍在项目内 `data/`，包括 `messages.db`、`contracts.db`、`registry.json` 与 `data/config/encryption.key`。企业目录或 `config.json.corpDir` 变更后，需要重启后端才能生效。

```bash
# 1. 后端 TypeScript 检查
cd happycompany && npx tsc --noEmit

# 2. 前端构建（必须从 web/ 目录执行）
cd happycompany/web && npm run build

# 3. 重启后端（后端 serve web/dist/ 静态文件，启动时加载到内存）
# 本地开发
cd happycompany && npx tsx src/index.ts

# 生产环境（PM2 常驻）
pm2 restart happycompany
```

注意事项：
- 前端改动只有 rebuild + 重启后端后才在 3100 生效
- 不要用临时端口启动 Vite dev server
- 重启后端前确认 3100 端口上的进程已完全退出：`kill $(lsof -i :3100 -t)`
- 备份至少包含 `$HAPPYCOMPANY_CORP_DIR`、`data/`、`config.json`、`data/config/encryption.key`
- 新企业上线前必须验证：企业切换、通讯录同步、人员绑定、入口聊天、工作流页面、权限拒绝路径

## Worktree Runtime Profile

多 worktree 并行研发时，每个 worktree 应使用独立 runtime profile，避免共用 `data/`、`../corp` 和固定端口。

后端 profile 默认读取：

```text
.runtime/{profile}/config.json
```

如果 profile config 省略 `dataDir` / `corpDir`，运行时默认使用：

```text
.runtime/{profile}/data
.runtime/{profile}/corp
```

示例：

```bash
# 后端
npm run dev:profile -- feat-builder

# 前端，端口和 API proxy 对齐该 profile
cd web && HAPPYCOMPANY_WEB_PORT=8891 HAPPYCOMPANY_API_PORT=3101 npm run dev

# E2E
cd web && HAPPYCOMPANY_PROFILE=feat-builder \
  HAPPYCOMPANY_WEB_PORT=8891 \
  HAPPYCOMPANY_API_PORT=3101 \
  npx playwright test
```

也可以不用 profile 名，直接指定配置文件：

```bash
HAPPYCOMPANY_CONFIG=.runtime/feat-builder/config.json npx tsx src/index.ts
```

`HAPPYCOMPANY_API_PORT` 只是前端/E2E 连接后端的端口；后端实际监听端口仍来自该 profile 的 `web.port`。

## Harness 验收用例 CLI

`MessageIngressRuntime` 的统一入口运行时配套一个 harness CLI，把 YAML case 喂给 Runtime 并对结构化 `IngressTrace` 断言。CI 用 `--fake` 跑确定性回归；真实 LLM 模式留给 smoke 跑。

```bash
# 跑一条 case
npx tsx src/harness-cli.ts --case tests/fixtures/harness/echo-basic.yaml --fake

# 跑整个 suite
npx tsx src/harness-cli.ts --suite tests/fixtures/harness --fake
```

真实链路验收连接运行中的后端服务，复用当前进程里的 `agentFactory`、员工绑定、AuthGate 和 MCP 注入：

```bash
npm run dev
npx tsx src/harness-cli.ts --case tests/fixtures/harness/sales-query-uses-med-crm.yaml \
  --server-url http://127.0.0.1:3100 \
  --admin-token "$HAPPYCOMPANY_ADMIN_TOKEN"
```

输出示例：

```
✓ echo-basic — passed
✓ no-handoff-and-no-tool — passed
✓ reply-contains — passed

3 passed, 0 failed (3 total)
```

Case 字段说明见 [src/ingress/adapters/harness.ts](../../src/ingress/adapters/harness.ts) 的 `caseSchema`；常用断言：`replyContains` / `toolNamesIncludes` / `toolNamesExcludes` / `memoryWorkspaceContains` / `handoffCount` / `routedEmployee` / `selectorShown` / `noErrors`。`--fake` 模式从 YAML 顶层读取 `fakeReply` 字段作为 stub 回复，无需访问 LLM。

### JSON 输出

加 `--json` 改输出为机器可读 JSON（plan §7 失败定位样例兼容），适合接入更上层的测试报告：

```bash
npx tsx src/harness-cli.ts --suite tests/fixtures/harness --fake --json | jq '.summary'
```

也可以写出完整 JSON 报告，报告包含每条 case 的失败项和 `IngressTrace`：

```bash
npm run harness:fake -- --output /tmp/happycompany-harness-report.json
```

返回结构：

```jsonc
{
  "summary": { "passed": 15, "failed": 0, "total": 15 },
  "cases": [
    {
      "id": "echo-basic",
      "status": "passed",
      "failures": [],
      "trace": { /* full IngressTrace */ }
    }
  ]
}
```

后端启动后，Web 管理台的 `/harness` 页面可以查看 fixture 列表、运行真实后端 suite、检查最近一次 trace 报告。


## 前端调试

调试前端渲染/崩溃问题时，**必须按此顺序**：

```
1. Vite dev server (8888) + fresh browser context → 可读错误
2. 定位根因 → 修复代码
3. tsc --noEmit + build → 编译通过
4. 重启后端进程 → 加载新 dist
5. fresh browser context 测试 production (3100) → 验证
```

| 陷阱 | 现象 | 解法 |
|------|------|------|
| 浏览器缓存旧 JS | rebuild 后仍加载旧 hash | 每次 `browser.newContext()` |
| 后端内存缓存 dist | rebuild 后 3100 不变 | 必须重启后端进程 |
| minified 错误无信息 | React #185 等 | 先 dev server 复现 |
