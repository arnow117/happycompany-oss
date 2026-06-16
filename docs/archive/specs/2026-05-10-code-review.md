# Phase 6 代码审查报告

审查时间：2026-05-10
审查范围：4 个 Phase 6 提交

## 审查结果概览

- **CRITICAL**: 2
- **HIGH**: 0
- **MEDIUM**: 1
- **LOW**: 3

---

## CRITICAL

### 1. TypeScript 类型错误：index.ts 中变量名不一致

**文件**: `src/index.ts:481`

**问题**: `startWebServer` 调用中传递了 `lockManager`，但该变量声明为 `writeLockManager`

```typescript
// 第 195 行声明
const writeLockManager = new WriteLockManager({ enabled: true, defaultTTL: 300_000 });

// 第 481 行使用（错误）
lockManager,  // ❌ 变量名错误
```

**影响**: 编译失败（TypeScript 错误 TS2552），代码无法运行

**修复**: 将 `lockManager` 改为 `writeLockManager`，或在声明时使用 `lockManager` 作为变量名

---

### 2. TypeScript 类型错误：LoadedApp 缺少 capabilities 属性

**文件**: `src/business-api.ts:315`

**问题**: 访问 `colonyAgent.app.capabilities`，但 `LoadedApp` 类型（在 `app-schema.ts` 中定义）没有 `capabilities` 字段

```typescript
capabilities: colonyAgent.app.capabilities || [],  // ❌ 类型错误
```

**影响**: 编译失败（TypeScript 错误 TS2339），代码无法运行

**修复**: 在 `appDefinitionSchema` 中添加 `capabilities` 字段定义，或移除此属性访问

---

## MEDIUM

### 1. 测试断言语义问题：并发锁测试的预期行为

**文件**: `tests/skill-bridge-write-lock.test.ts:67-77`

**问题**: 测试 `buildMcpTools denies write when locked by another agent` 的断言与注释不符

```typescript
// 预期：sales-2 应该被拒绝，因为 sales-1 已经持有锁
// 实际：sales-2 获得了自己的锁（因为 entityId = agentId）

expect(result.isError).toBeFalsy();  // 通过
expect(lockMgr.isLocked('med_crm:add_sales_activity', 'sales-2')).toBe(true);  // 通过
```

**分析**: 当前实现中锁的 `entityId` 直接使用 `agentId`，意味着每个 agent 获得的是独立的锁实例，不存在"另一个 agent 持有同一实体的锁"的情况。测试名称暗示了应该有并发冲突，但实际没有。

**建议**:
- 如果这是预期的设计（每个 agent 独立锁），重命名测试以反映真实行为
- 如果需要真正的并发冲突检测，需要修改锁机制，使 `entityId` 代表业务实体而非 agent

---

## LOW

### 1. Mock 对象创建顺序问题

**文件**: `tests/business-api.test.ts:245-247`

**问题**: `skillBridge` 在 `appServerMgr` 初始化之前创建

```typescript
skillBridge = new SkillBridge({ toolRegistry: {} as any, appServerMgr, corpDir: '/test/corp' });
appServerMgr = new AppServerMgr();  // 在 skillBridge 之后才初始化
```

**影响**: `appServerMgr` 传递给 `SkillBridge` 时为 `undefined`

**建议**: 调整初始化顺序

---

### 2. 测试中不必要的可选链

**文件**: `tests/skill-bridge-write-lock.test.ts:88`

**问题**: 使用了 `as any` 类型断言

```typescript
{ id: 'test', displayName: 'Test', tools: ['med_crm:add_sales_activity'], skills: [] } as any
```

**建议**: 定义适当的测试类型，避免 `any`

---

### 3. 内联魔法数字

**文件**: `src/index.ts:195`

**问题**: TTL 值作为魔法数字

```typescript
const writeLockManager = new WriteLockManager({ enabled: true, defaultTTL: 300_000 }); // 5 min
```

**建议**: 提取为命名常量（如 `DEFAULT_WRITE_LOCK_TTL_MS`）

---

## 代码质量评估

### commit a76021a (write-lock integration)
- **优点**: 实现清晰，测试覆盖全面
- **问题**: 测试语义与实际行为可能不符（见 MEDIUM #1）

### commit 82bc741 (real data sources wiring)
- **优点**: API 路由设计合理，测试覆盖新端点
- **问题**: 类型错误（CRITICAL #2），mock 初始化顺序（LOW #1）

### commit e522527 (Phase 5 integration test)
- **优点**: 测试覆盖完整，6 个测试验证端到端流程
- **问题**: 无明显问题

### commit 72a0c77 (DashboardCards test fix)
- **优点**: 正确修复了 React Router 上下文问题
- **问题**: 无明显问题

---

## 安全审查

- ✅ 无硬编码密钥
- ✅ 无 SQL 注入风险
- ✅ 无 XSS 风险
- ⚠️ 输入验证：`from`/`to` 查询参数使用 `parseInt` 但无 NaN/范围检查（非关键）

---

## 架构一致性

- ✅ 遵循现有依赖注入模式
- ✅ 可选依赖使用正确（`BusinessDeps` 中的可选字段）
- ✅ API 响应格式一致

---

## 建议行动

1. **立即修复**: CRITICAL #1 和 CRITICAL #2（类型错误）
2. **评估修复**: MEDIUM #1（测试语义问题）
3. **后续优化**: LOW #1-3（代码质量改进）
