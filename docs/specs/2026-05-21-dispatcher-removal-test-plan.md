# 调度员退化 + Fork 实例化 — 测试方案

**日期**: 2026-05-21
**关联**: [ADR-003](../adr/2026-05-21-003-dispatcher-as-router-fork-instances.md)

## 一、改了什么

1. `acme-dispatcher` 从 Agent 退化为纯代码路由层
2. `entryEmployeeId` 从 BotConfig 移除
3. 路由层新增 fork 实例化逻辑（懒加载，首次消息时从模板复制）
4. 无绑定用户不再路由到 dispatcher，改为提示去绑定

## 二、测试策略总览

```
Layer 1: 纯路由函数单元测试（无 IO，fast）
Layer 2: Fork 实例化单元测试（有文件 IO）
Layer 3: 集成测试（真实后端 + sandbox config）
Layer 4: E2E 测试（前端 + 后端）
```

## 三、Layer 1: 路由函数测试

**文件**: `tests/enterprise-bot-routing.test.ts`（修改现有）

### 已有测试（保留，微调）

| 用例 | 说明 |
|------|------|
| 已知用户路由到个人助手 | people.json assistantId 命中 → 直连 |
| 钉钉用户通过 enterprise people binding 路由 | 同上 |
| 传递 prompt 做角色路由 | roleBindings 按关键词匹配 |

### 新增测试

| 用例 | 说明 |
|------|------|
| `routingMode: 'direct'` 走直连模式，不查绑定 | Bot 当独立 agent 直接用 |
| `routingMode: 'employee-director'` + 无绑定用户 → 返回 `null` + 提示 | 不再 fallback 到 dispatcher |
| `routingMode: 'employee-director'` + 绑定不存在 → 返回 null | ID 有效但 agent 未注册 |
| `routingMode: 'employee-director'` + 无 `tenant` → 走 direct | 缺少租户上下文 |

### 删除测试

| 用例 | 原因 |
|------|------|
| "routes an enterprise bot to its configured entry employee" | `entryEmployeeId` 字段已移除 |
| dispatcher 注册相关断言 | dispatcher 不再是 agent |

## 四、Layer 2: Fork 实例化测试

**文件**: `tests/orchestrator/employee-colony.test.ts`（新增用例）

| 用例 | 说明 |
|------|------|
| fork 不存在时，首次绑定 → 创建实例 | 检查 `agents/{employeeId}-{userId}/` 目录被创建 |
| fork 已存在时，复用现有实例 | 不重复创建 |
| fork 复制模板的 CLAUDE.md | 内容一致 |
| fork 复制模板的 SKILL.md | 内容一致 |
| skills 通过 symlink 引用共享池 | 非物理复制 |
| fork 非法 ID → 报错不创建 | 路径安全校验 |

**文件**: `tests/enterprise-bot-routing.test.ts`（新增用例）

| 用例 | 说明 |
|------|------|
| 有绑定 + fork 不存在 → 排查绑定有效性 | 确认 assistantId 指向合法模板 |
| 有绑定 + fork 存在 → 直接返回实例 agent ID | 不重复 fork |

## 五、Layer 3: 集成测试

**文件**: `tests/integration-colony.test.ts`（修改现有）

| 用例 | 说明 |
|------|------|
| 完整 employee-director 流程：people.json 绑定 → 新建 fork → 消息直达 | 端到端 |
| 多角色绑定路由正确性 | roleBindings 按 prompt 关键词匹配 |

### 删除

| 用例 | 原因 |
|------|------|
| dispatcher 注册后的消息路由测试 | dispatcher 不再是 agent |
| `entryEmployeeId` 字段相关测试 | 字段已移除 |

## 六、Layer 4: E2E 测试

**文件**: `web/e2e/story-config-page/story-config.spec.ts`（修改现有）

| 改动 | 说明 |
|------|------|
| MOCK_CONFIG 移除 `entryEmployeeId` 字段 | 对应 BotConfig 变更 |
| 配置页表单不再有"入口员工 ID"选择 | UI 同步变更 |

### 新增（后续）: Story 企业聊天 E2E

```
场景: 已绑定用户的聊天流程
  Given people.json 绑定了 userId=foo → assistantId=sales-zhangsan
  When 用户 foo 发送消息到 acme bot
  Then 消息被路由到 sales-zhangsan-foo（fork 实例）
  And 返回 sales-zhangsan-foo 的响应

场景: 未绑定用户的聊天流程
  When 未绑定用户发消息到 employee-director bot
  Then 收到提示"请先绑定数字员工"
```

## 七、Config 测试

**文件**: `tests/config.test.ts`（修改现有）

| 改动 | 说明 |
|------|------|
| 移除 `entryEmployeeId` 相关断言 | 字段废弃 |

**文件**: `tests/api-integration/admin-config.test.ts`（修改现有）

| 改动 | 说明 |
|------|------|
| Bot 配置不包含 `entryEmployeeId` | 字段移除 |

## 八、前端 Config 页测试

**文件**: `web/src/pages/Config.test.tsx`（修改现有）

| 用例 | 说明 |
|------|------|
| employee-director 模式不再显示入口员工 ID 选择 | UI 变更 |
| 租户下拉仍正常显示 | 保留功能 |

## 九、验证命令

```bash
# 全量
cd happycompany && npx vitest run

# 路由层
npx vitest run tests/enterprise-bot-routing.test.ts

# 集成
npx vitest run tests/integration-colony.test.ts tests/bot.test.ts

# E2E
cd web && npx playwright test --config playwright.config.ts
```
