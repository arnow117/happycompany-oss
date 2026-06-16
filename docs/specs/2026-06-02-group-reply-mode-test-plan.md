# Group Reply Mode Test Plan

**日期**: 2026-06-02

## 改动总览

为 Bot 配置增加 `groupReplyMode`，控制群聊中 Bot 是只回复 @ 消息，还是回复所有群消息。

## 测试策略

- 单元测试：覆盖 BotManager 群聊响应决策。
- 配置测试：覆盖 `config.json` 解析和 admin config 保存字段。
- 前端测试：覆盖 Config 页表单可编辑并保存群聊响应模式。
- E2E：覆盖 Config 页新增控件渲染。

## 新增用例

| 层级 | 用例 | 输入 | 预期 |
|------|------|------|------|
| BotManager | 默认群聊只回复 @ | `groupReplyMode` 未设置，群消息无 @ | 不调用 agent |
| BotManager | 群聊全量回复 | `groupReplyMode: "all"`，群消息无 @ | 调用 agent |
| Config | 解析字段 | bot 配置含 `groupReplyMode: "all"` | `loadConfig()` 返回该字段 |
| Admin route | 保存字段 | POST `/api/admin/config` bots 含 `groupReplyMode` | `configRef.current.bots[name].groupReplyMode` 更新 |
| Web | 表单保存字段 | Config 页编辑 Bot 选择“所有群消息” | `saveAdminConfig` payload 含 `groupReplyMode: "all"` |
| E2E | 控件可见 | 打开 Config 新增 Bot 表单 | 群聊响应模式下拉可见 |

## 验证命令

```bash
env VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/bot.test.ts tests/config.test.ts tests/routes/admin-config.test.ts
cd web && npm run test -- Config.test.tsx
npx tsc --noEmit
cd web && npm run build
cd web && npx playwright test story-config-page/story-config.spec.ts
```
