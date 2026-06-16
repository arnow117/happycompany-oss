# 钉钉企业入口路由冷启动 Runbook

> 日期：2026-05-18（初版），2026-05-21（更新——ADR-003 调度员退化）  
> 目标：把"一个企业钉钉 Bot + 内部数字员工分发"跑成可复现闭环。

## 架构变更（ADR-003）

`acme-dispatcher` 不再作为 Agent 存在。入口路由退化为纯代码层：查 `people.json` 绑定 → fork 实例（懒加载）→ 直连。详见 `docs/adr/2026-05-21-003-dispatcher-as-router-fork-instances.md`。

## 当前代码状态

- 钉钉消息解析会把 `senderStaffId` 写入 `NormalizedMessage.fromUserId`。
- `BotManager` 会把 `fromUserId` 传给 `agentFactory.respond(..., { userId })`。
- 企业入口 Bot 的 `routingMode: employee-director` 执行纯路由：
  1. 查 `people.json` 是否有 `assistantId` 绑定
  2. 有绑定 → 检查 fork 实例是否存在 → 不存在则从模板 fork → 直连
  3. 无绑定 → 返回提示，引导去企业员工页绑定
- 企业员工页绑定的 `people.json.assistantId` 由 `EmployeeManager.findByHumanUserId(...)` 消费。
- 员工间相互查找走 `routeHandoff()` 关键词 + LLM fallback 机制（保留）。

## 冷启动步骤

1. 登录 DWS：

```bash
dws auth login
```

2. 同步示例医疗根部门通讯录：

```bash
dws contact dept list-members --ids 1 --format json
```

或通过 Web 管理台：

```http
POST /api/enterprise-people/sync?tenant=acme
```

3. 在企业员工页绑定个人助手：

```text
/people
个人助手：sales-zhangsan / maintenance-lisi / finance-wangwu / hr-onboarding 等
```

4. 配置企业入口 Bot：

```json
{
  "tenant": "acme",
  "routingMode": "employee-director"
}
```

不再需要 `entryEmployeeId` 字段。

5. 真实聊天验证：

```text
钉钉员工发送消息
→ DingTalkChannel 解析 senderStaffId
→ BotManager 传 userId
→ 路由层查 people.json
→ assistantId 命中 → fork 实例 → 直连个人数字员工
→ 无绑定 → 提示去 /people 绑定
```

如果用户有 `roleBindings`（多角色），路由层按消息内容关键词匹配角色 → 对应 assistantId。

## 示范绑定（people.json）

```json
{
  "赵六": { "assistantId": "sales-zhangsan" },
  "沈杨": { "assistantId": "maintenance-lisi" },
  "温瀚翔": { "assistantId": "finance-wangwu" },
  "管理员": {
    "roleBindings": [
      { "role": "sales", "assistantId": "sales-zhangsan" },
      { "role": "maintenance", "assistantId": "maintenance-lisi" },
      { "role": "finance", "assistantId": "finance-wangwu" }
    ]
  }
}
```
