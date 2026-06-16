# User Bootstrap Design

**更新**: 2026-05-24 — Workdir 导入链路落地为“扫描识别 → 确定性员工拆分建议 → 依赖校验 → 用户确认 → 生成员工 YAML”。LLM 拆分保留为后续可替换的 draft 生成策略，不阻塞当前闭环。

> 用户首次进入平台到在 IM 上与数字员工团队对话的完整引导流程设计。
> 三个独立配置页面 + 一个引导壳串联，各自可重入修改。

## 背景与目标

当前 Setup.tsx（配模型+建Bot）和 Onboarding.tsx（建租户+首员工）是两个独立页面，之间无引导。裸机用户需要自己拼凑流程。

**目标：** 三个独立配置页面，通过 Onboarding 引导壳串联，让裸机用户从零到在 IM 上与数字员工团队对话。每个页面独立可重入。

**三种用户路径共享同一套页面：**
- OPC（一人公司）：裸机起步，自助完成，走 Workdir 导入
- FDE（现场部署）：为客户选行业模板，快速交付
- 公司自迭代：基于已有配置调整人员绑定

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 页面结构 | 三个独立页面 + 引导壳 | 各自可重入修改，不强耦合 |
| 团队创建方式 | 双入口：行业模板 / Workdir 导入 | 企业用户走模板，OPC/FDE 走导入 |
| 工具协议 | Skill-only（去掉 tools.json） | 降低创建门槛，SKILL.md + bin/ 足够 |
| 入口路由 | 纯工程实现，不走 LLM | 零延迟、零 token、确定性 |
| 员工间协作 | 平台内置 skill（bin/collaborate） | LLM 驱动，通过 skill 调用平台 API |

---

## 整体结构

```
┌─ Onboarding 引导壳 ────────────────────────────────────┐
│                                                         │
│  检测三个页面的完成状态，高亮"下一步"，提供导航。         │
│  首次全部完成后，引导壳自动消失（不阻塞日常使用）。       │
│  三个页面在侧边栏保留入口，随时可回来改。                │
│                                                         │
│  ① ──→ ② ──→ ③                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘

① LLM 基础配置        ② 创建/导入员工网络      ③ 人员导入与绑定
   (ModelConfig.tsx)      (EmployeeNetwork.tsx)     (PeopleBinding.tsx)
```

| # | 页面 | 首次做什么 | 后续重入改什么 |
|---|---|---|---|
| ① | LLM 配置 | 配 API Key / Base URL | 换模型、换 provider、加备用 |
| ② | 员工网络 | 选行业模板或导入 Workdir + 连 IM 渠道 | 加员工、改模板、重新导入、换渠道 |
| ③ | 人员绑定 | 导入企业通讯录 + 每人绑定入口员工+可见范围 | 加人、改绑定、调权限 |

---

## ① LLM 基础配置（ModelConfig.tsx）

基于现有 Setup.tsx 改造，去掉 Bot 配置部分（Bot 配置移到②）。

### 功能

- 选择 Provider：官方 API（Anthropic API Key）或第三方（Base URL + Auth Token）
- 可选填 Model 名称
- 测试连接验证
- 保存到 config.json

### 完成条件

模型配置已保存且验证通过。

### 后续重入

侧边栏"模型配置"入口 → 修改 provider/Key/URL。

### API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/setup-status` | GET | 检查是否已配置 |
| `/api/admin-config` | POST | 保存模型配置 |
| `/api/verify-model` | POST | 验证模型连接 |

---

## ② 创建/导入员工网络（EmployeeNetwork.tsx）

替代原 Onboarding.tsx。这是三个页面中最大的一个。

### 功能

#### 路径 A：从行业模板创建

选择行业（3-5 个预定义） → 加载模板 → 展示推荐员工列表 → 用户可改名/增删 → 创建租户 + 员工。

适用于：企业客户（FDE 帮选）、快速起步的 OPC。

#### 路径 B：从 Workdir 导入

指定 workdir 路径 → 扫描识别 → 员工拆分建议 → 依赖校验 → 确认员工列表 → 创建租户 + 员工。

适用于：已有 Claude Code 工程的 OPC、FDE 接入客户现有系统。

**导入流程必须完成拆分为具体员工才算完成。** 不是"挂了一堆 skill"，而是每个员工都绑定好 skill，形成完整组织。

当前实现使用确定性拆分策略：每个被扫描到的 skill 生成一个可编辑员工草稿，用户可在导入前修改员工名称、角色 ID 和说明。导入请求携带 `employeeDrafts`，后端根据草稿生成 `corp/{tenant}/employees/*.yaml` 并注册到 EmployeeManager。后续如需升级为 LLM 聚类，只替换 draft 生成逻辑，确认、校验和导入契约保持不变。

#### IM 渠道配置（本页内）

创建员工网络后，在同一页面配置 IM 渠道连接：
- 钉钉：Client ID + Client Secret
- 飞书：App ID + App Secret
- 可跳过，后续补

### 完成条件

租户已创建 + 至少 1 个员工 YAML 已生成 + IM 渠道已配置（或已跳过）。

### 后续重入

侧边栏"员工网络"入口 → 查看/编辑员工、重新导入 Workdir、增删员工、修改渠道。

### API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/tenants` | POST | 创建租户 |
| `/api/templates` | GET | 列出可用行业模板 |
| `/api/employees` | GET/POST | 列出/创建员工 |
| `/api/employees/generate` | POST | NL→YAML 生成 |
| `/api/workdir/scan` | POST | 扫描 workdir |
| `/api/workdir/sync` | POST | 增量同步 |
| `/api/tenants/{id}/export` | GET | 导出租户 |
| `/api/tenants/{id}/save-as-template` | POST | 保存为模板 |

---

## ③ 人员导入与绑定（PeopleBinding.tsx）

新增页面。基于现有 EnterprisePeople.tsx 扩展。

### 功能

#### 人员导入

从企业 IM 同步通讯录，或手动添加人员。

#### 入口员工绑定

每个人员配置：
- **入口员工**（entryEmployee）：该用户发消息时默认进入哪个员工的 session
- **可见员工范围**（visibleEmployees）：该用户能看到/切换到哪些员工
- **路由模式**（routingMode）：`bound`（走默认绑定）或 `selector`（每次选择）

#### 默认设置

OPC 场景：创建者本人自动绑定第一个员工，可见范围设为全部。
FDE 场景：为客户的每个关键人员配置绑定。

### people.json 扩展

```json
{
  "zhangsan": {
    "displayName": "张三",
    "entryEmployee": "sales-zhangsan",
    "routingMode": "bound",
    "visibleEmployees": ["sales-zhangsan", "finance-wangwu", "maintenance-lisi"]
  },
  "lisi": {
    "displayName": "李四",
    "entryEmployee": "maintenance-lisi",
    "routingMode": "selector",
    "visibleEmployees": ["maintenance-lisi", "sales-zhangsan"]
  }
}
```

### 完成条件

至少 1 个人员已配置入口员工绑定。

### 后续重入

侧边栏"人员管理"入口 → 加人、改绑定、调可见范围。

### API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/tenants/{id}/people` | GET/PUT | 读取/更新人员绑定 |
| `/api/tenants/{id}/people/sync` | POST | 从企业 IM 同步通讯录 |

---

## Onboarding 引导壳

不是新页面，而是现有 Layout 中的导航逻辑。

### 行为

```
App 启动
  │
  ├─ ① 未完成 → 顶部横幅："请先配置模型" → 点击跳 ModelConfig
  │
  ├─ ① 完成，② 未完成 → 横幅："创建你的数字员工团队" → 跳 EmployeeNetwork
  │
  ├─ ①② 完成，③ 未完成 → 横幅："配置人员绑定，让团队成员开始使用" → 跳 PeopleBinding
  │
  └─ ①②③ 全部完成 → 横幅消失，正常使用
```

### 实现方式

```typescript
// stores/chat.ts 或新 store
interface OnboardingState {
  steps: {
    modelConfigured: boolean;       // ①
    employeeNetworkReady: boolean;  // ②
    peopleBound: boolean;           // ③
  };
  nextStep(): number | null;       // 返回 1/2/3 或 null（全部完成）
}
```

API `/api/setup-status` 扩展为返回三个步骤的完成状态。

---

## 行业模板体系

### 目录结构

```
corp/templates/industries/
├── med-device/              # 医疗器械
│   ├── template.json        # 模板元数据 + 员工清单 + 协作流
│   ├── roles/               # 角色定义 YAML
│   ├── employees/           # 员工定义 YAML
│   └── roles.json           # 角色-工具权限
├── ecommerce/               # 电商零售
├── professional-service/    # 专业服务
├── general/                 # 通用
└── schema.ts                # Zod 校验
```

### template.json 格式

```json
{
  "id": "med-device",
  "name": "医疗器械",
  "description": "适合医疗器械经销/生产企业",
  "version": "1.0.0",
  "employees": [
    { "template": "employees/sales-zhangsan.yaml", "role": "sales" },
    { "template": "employees/finance-wangwu.yaml", "role": "finance" },
    { "template": "employees/maintenance-lisi.yaml", "role": "maintenance" }
  ],
  "defaultRoles": "roles.json",
  "collaboration": {
    "flows": [
      { "name": "合同审批", "path": ["sales", "finance"] },
      { "name": "售后维修", "path": ["maintenance", "sales"] }
    ]
  }
}
```

### 维护方式

| 角色 | 操作方式 |
|---|---|
| 平台开发 | 直接编辑 `corp/templates/industries/` 下的文件，走 git |
| FDE | Web 界面模板编辑器或 skill：基于现有模板克隆 → 修改 → 保存为新模板 |
| OPC | 不直接改模板，EmployeeNetwork 页面中做轻量调整（改名/增删） |

### 模板实例化

选择模板后，将模板内容复制到租户目录：

```
corp/templates/industries/med-device/  →  corp/{tenant}/
  employees/sales-zhangsan.yaml          employees/sales-{name}.yaml
  employees/finance-wangwu.yaml          employees/finance-{name}.yaml
  roles.json                             roles.json
```

---

## Workdir 导入

### 扫描目标

| 路径 | 提取信息 |
|---|---|
| `.claude/skills/*/SKILL.md` | skill 名称、描述、能力 |
| `apps/*/tools.json` | 应用和操作列表（过渡期兼容） |
| `CLAUDE.md` / `AGENTS.md` | 项目上下文 |
| `bin/` 目录 | 执行入口 |
| `package.json` / `requirements.txt` | 运行时依赖 |

### 拆分流程

1. **Phase 1 — 扫描识别**：提取所有 skill、脚本、依赖信息
2. **Phase 2 — 员工拆分建议**：按 skill 生成可编辑员工草稿；后续可替换为 LLM 聚类建议
3. **Phase 3 — 依赖校验**：检查脚本存在性、可执行性、沙箱边界
4. **Phase 4 — 用户确认**：展示建议的员工列表，可调整

### 依赖校验规则

1. **存在性**：脚本路径必须在 workdir 范围内，防 path traversal
2. **可执行性**：文件有 exec 权限，shebang 正确
3. **运行时依赖**：Python/Node 依赖是否安装
4. **沙箱边界**：所有执行限制在 workdir 内，不允许访问外部路径

### SKILL.md 依赖声明

```yaml
---
name: med-crm
description: 医疗器械 CRM 操作
has-write-ops: true
dependencies:
  runtime: python3
  packages: [pandas, requests]
  scripts:
    - path: bin/run
      access: exec
    - path: data/hospital_db.csv
      access: read
---
```

frontmatter 里的 `dependencies` 给校验器用。LLM 只读 body 里的调用说明。

### 持续同步

- `corp/{tenant}/workdir-sync.json` 记录导入源路径和文件 hash
- 定期重导入：比较 hash，只同步变更
- 新增 skill → 提示分配给员工
- 删除 skill → 警告对应能力失效

---

## Skill 体系简化

### 从三层到两层

```
之前：SKILL.md + tools.json + bin/
现在：SKILL.md（含调用方式描述）+ bin/（或 scripts/）
```

### skill-bridge.ts 变更

不再从 tools.json 读 schema 生成 MCP tools。改为：
1. 读 SKILL.md 提取能力描述
2. 注册为 Bash tool + 约束（"只能调这个 skill 下的命令"）
3. 写锁保护在 skill 层面（`has-write-ops: true`）

---

## 两层路由架构

### 第一层：入口路由（纯工程）

不经过 LLM，毫秒级响应。在 `entry-router.ts` 中实现。

```
用户发消息给 Bot
  │
  ├─ 消息以 / 开头 → Slash 命令处理
  │    /小张    → 切到销售员工
  │    /小王    → 切到财务员工
  │    /list    → 显示团队列表
  │
  ├─ 有默认绑定 → 直接进入该员工 session
  │
  └─ 无默认绑定 → 返回选择器
       "请选择对话对象：1.销售小张 2.财务小王 3.售后李工"
       用户回复数字/名字 → 进入对应 session
```

选择器和 slash 命令只展示该用户 `visibleEmployees` 范围内的员工。

### 第二层：员工间协作（LLM 驱动）

通过平台内置 skill "collaborate" 实现。

```
员工 A（Claude Agent session）
  │
  ├─ 自己能处理 → 直接回复
  │
  └─ 需要其他人帮忙
       │
       ▼ 调用 collaborate skill
          bin/collaborate --target finance \
                         --message "客户要开票..." \
                         --mode async

          平台内部（/internal/collaborate）：
          ├─ target 是角色名 → 按角色找员工
          ├─ target 是能力描述 → 遍历 skill 列表匹配
          ├─ mode async → 在目标 session 投递 → 等回复 → 转达
          └─ mode sync → 直接转接
```

**collaborate skill：**

```yaml
---
name: collaborate
description: 与团队其他数字员工协作
has-write-ops: false
internal: true
---
```

| | 入口路由 | 协作路由 |
|---|---|---|
| 决策者 | 工程代码 | LLM |
| 触发方式 | 用户发消息 / slash | 员工调用 skill |
| 延迟 | 毫秒 | 秒级 |
| token | 0 | 有 |

---

## IM 首次体验

三个页面全部完成后，用户首次在 IM 发消息：

```
用户：你好

调度员：
  你好！你的数字员工团队已就绪，一共 3 位成员。

  销售小张（基于医疗器械行业·销售模板）
     查医院、查设备、记录销售活动。说"小张"找我。

  财务小王（基于医疗器械行业·财务模板）
     开票、报销审批、合同审核。说"小王"就行。

  售后李工（基于医疗器械行业·售后模板）
     设备维修、维保合同、现场服务。叫我"李工"。

  你可以直接说名字找对应的人，或者说你要做什么我帮你找。
```

导入路径的员工：

```
  数据分析师（从你的工作目录导入）
     执行数据查询、生成报表、分析趋势。
```

---

## 导出与模板保存

### 导出

`GET /api/tenants/{id}/export` → zip 包含：

```
tenant-export.json     # 元数据（版本、时间、租户信息）
employees/             # 全部员工 YAML
roles.json             # 角色配置
people.json            # 人员绑定
.claude/skills/        # 全部 skill
apps/                  # 关联应用
```

### 保存为模板

`POST /api/tenants/{id}/save-as-template`：

1. 复制 employees/ → 去掉租户特定信息（人名变角色名）
2. 复制 skills/ → 保留通用部分
3. 生成 template.json
4. 写入 `corp/templates/industries/{new-template}/`

---

## Employee YAML Schema 变更

```typescript
// employee-schema.ts 新增字段
const employeeDefinitionSchema = z.object({
  // ...existing fields...
  displayName: z.string().optional(),      // 展示名（如"销售小张"）
  template: z.string().optional(),         // 来源模板（如"med-device/sales"）
  oneLiner: z.string().optional(),         // 自我介绍一句话
});
```

---

## API 变更汇总

### 新增

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/templates` | GET | 列出可用行业模板 |
| `/api/workdir/scan` | POST | 扫描 workdir |
| `/api/workdir/sync` | POST | 增量同步 |
| `/api/tenants/{id}/export` | GET | 导出租户 |
| `/api/tenants/{id}/save-as-template` | POST | 保存为模板 |
| `/api/tenants/{id}/people` | GET/PUT | 读取/更新人员绑定 |
| `/api/tenants/{id}/people/sync` | POST | 从企业 IM 同步通讯录 |
| `/internal/collaborate` | POST | 员工间协作 |

### 保留

| 端点 | 说明 |
|---|---|
| `/api/setup-status` | 检查是否已配置（扩展返回三步状态） |
| `/api/admin-config` | 保存模型配置 |
| `/api/verify-model` | 验证模型连接 |
| `/api/tenants` POST | 创建租户 |
| `/api/employees` | 员工 CRUD |
| `/api/employees/generate` | NL→YAML 生成 |

### 废弃

| 文件/接口 | 处理 |
|---|---|
| `Setup.tsx` | 改造为 ModelConfig.tsx（去掉 Bot 配置） |
| `Onboarding.tsx` | 替换为 EmployeeNetwork.tsx |
| `tools.json` 规范 | 逐步移除 |

---

## 新增/改造文件清单

| 文件 | 说明 |
|---|---|
| `web/src/pages/ModelConfig.tsx` | 改造自 Setup.tsx，LLM 配置专用 |
| `web/src/pages/EmployeeNetwork.tsx` | 新建，替代 Onboarding.tsx，员工网络创建/导入 |
| `web/src/pages/PeopleBinding.tsx` | 新建，人员导入与 agent 绑定 |
| `web/src/components/OnboardingBanner.tsx` | 引导壳横幅，检测步骤状态 |
| `src/entry-router.ts` | 入口路由（纯工程） |
| `src/skill-validator.ts` | Skill 依赖校验器 |
| `src/template-loader.ts` | 行业模板加载器 |
| `src/workdir-scanner.ts` | Workdir 扫描分析 |
| `bin/collaborate` | 员工协作 skill 入口 |
| `corp/templates/industries/general/` | 通用行业模板 |
