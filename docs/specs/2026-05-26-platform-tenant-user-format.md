# 平台企业切换与用户格式

**更新**: 2026-05-26 — 统一平台视角的企业上下文和企业用户绑定格式。

## 背景

HappyCompany 是多企业平台，企业数据位于 `corp/{tenant}`。前端此前存在两套企业选择方式：聊天侧边栏使用 Zustand 中的 `selectedTenant`，人员页面使用本地输入框。企业用户绑定也存在新旧两种字段：旧字段 `assistantId`，新字段 `entryEmployee/routingMode/visibleEmployees`。

## 决策

平台级企业上下文统一为：

- `TenantMeta`: `{ id, displayName, description? }`
- 前端全局状态：`useChatStore.selectedTenant`
- 持久化键：`localStorage["hc-selectedTenant"]`
- 企业列表 API：`GET /api/tenants`，返回 `{ tenants: TenantMeta[] }`

企业用户绑定统一为：

```ts
interface EnterprisePerson {
  userId: string;
  name: string;
  departments: Array<{ id: string; name: string }>;
  status: 'active' | 'inactive';
  source: 'dingtalk' | 'manual';
  syncedAt: number;
  updatedAt: number;
  role?: string; // 权限角色，写入 roles.json users
  entryEmployee?: string;
  routingMode?: 'bound' | 'selector';
  visibleEmployees?: string[];
  roleBindings?: Array<{ role: string; assistantId: string }>;
}
```

`assistantId` 仅作为兼容输入：后端收到旧字段时转换为 `entryEmployee`，不作为核心字段继续保存。

## 行为

- 侧边栏企业切换写入 `selectedTenant`，聊天和平台页面共享该企业上下文。
- 企业员工页读取当前企业，使用下拉切换企业，不再要求用户手输租户。
- 人员绑定页仍保留 URL `?tenant=` 和手动输入能力，用于 onboarding 和调试；同时会同步全局企业上下文。
- 员工列表 API 支持 `GET /api/employees?tenant={id}`，平台页面只展示当前企业的数字员工。

## 测试

- 后端：企业人员路由测试覆盖旧 `assistantId` 到新 `entryEmployee` 的兼容迁移。
- 前端：PeopleBinding 测试重置全局 tenant store，避免跨用例污染。
- E2E：完整产品旅程覆盖企业员工绑定、人员绑定、员工 fork 和入口路由。
