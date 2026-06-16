# 企业部署加固测试计划

**日期**: 2026-05-27

## 改动总览

收紧平台 API 鉴权、生产启动配置、租户参数校验、企业人员绑定校验和数字员工租户作用域。

## 测试策略

- 单元测试：覆盖租户解析、企业人员绑定校验、EmployeeManager 同名员工跨租户注册。
- 集成测试：覆盖管理员鉴权 middleware 和生产缺少 `adminToken` 的启动前校验。
- 前端测试：覆盖人员绑定页面跟随全局租户、企业切换器显示当前企业。
- E2E：覆盖用户故事产品旅程，并新增企业切换请求当前租户的断言。

## 新增用例

- `GET /api/enterprise-people?tenant=../x` 返回 400。
- `POST /api/enterprise-people/:userId/bind` 绑定不存在的 `entryEmployee` 返回 400。
- `POST /api/enterprise-people/:userId/bind` 绑定不属于当前企业的 `visibleEmployees` 返回 400。
- `EmployeeManager` 注册 `acme/sales` 和 `acme/sales` 后两个实例都存在。
- 生产环境缺少有效 `adminToken` 时配置校验失败。
- 受保护模式下 `/api/tenants`、`/api/enterprise-people`、`/api/chats` 无 Token 返回 401。

## 修改用例

- E2E `/api/tenants` mock 统一返回 `{ tenants: [...] }`。
- 工作流页面 mock 需要断言带 `tenant` query。

## 验证命令

```bash
npx tsc --noEmit
VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/enterprise-people-routes.test.ts tests/orchestrator/employee-colony.test.ts tests/api-integration/auth-middleware.test.ts
cd web && npm run typecheck -- --noEmit
cd web && npm run build
cd web && npx playwright test
```
