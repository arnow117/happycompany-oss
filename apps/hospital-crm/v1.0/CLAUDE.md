# hospital-crm — 开发指导

## 技术栈

- **语言**: Python 3.12
- **CLI**: Click
- **ORM**: SQLAlchemy 2.0 (SQLite)
- **包管理**: uv
- **测试**: pytest

## 数据库

默认路径：`cdata/crm.db`（通过 `WORKDIR` 环境变量控制工作目录）。
数据库迁移在 `db.py` 的 `_run_migrations()` 中，用 `_ensure_column` 保证幂等。

## 数据模型

### Hospital（医院）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 |
| name | String(256) UNIQUE | 医院名称 |
| normalized_name | String(256) | 标准化名称 |
| province | String(32) | 省份 |
| city | String(64) | 城市 |
| district | String(64) | 区县 |
| level | String(64) | 医院等级 |
| bed_count | Integer | 床位数 |
| annual_revenue | Float | 年收入（亿） |
| channel | String(16) | 渠道 |
| source_db | String(32) | 数据来源（l10/l2） |
| notes | Text | 备注 |

### Device（装机设备）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 |
| hospital_id | FK hospitals.id | 所属医院 |
| ucmid | String(50) | 设备唯一码 |
| supplier | String(255) | 代理商 |
| device_category | String(50) | 设备类别 |
| product_name | String(255) | 产品名称 |
| brand | String(100) | 品牌 |
| product_tier | String(50) | 产品档次 |
| source | String(50) | 数据来源 |

唯一约束：`(hospital_id, ucmid)`

### MaintenanceDevice（维保设备）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 |
| hospital_id | FK hospitals.id | 所属医院 |
| product_name | String(255) | 产品名称 |
| brand | String(100) | 品牌 |
| product_tier | String(50) | 产品档次 |
| contract_start | Date | 合同开始 |
| contract_end | Date | 合同结束 |
| planned_count | Integer | 计划保养次数 |
| completed_count | Integer | 已完成次数 |
| next_maintenance_date | Date | 下次保养日期 |
| reminder_frequency | String(50) | 提醒频率 |
| notes | Text | 备注 |

唯一约束：`(hospital_id, product_name)`

### BidWin（中标信息）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 |
| hospital_id | FK hospitals.id | 所属医院 |
| project_code | String(100) | 项目编号 |
| announcement_url | String(500) | 公告链接 |
| contract_url | String(500) | 合同链接 |
| contract_amount | Float | 合同金额（元） |
| supplier | String(255) | 供应商 |
| contract_no | String(100) | 合同号 |
| publish_date | DateTime | 发布日期 |
| device_category | String(20) | 设备类别 |
| supplier_category | String(20) | 供应商类别（己方/竞品） |
| stage | String(10) | 阶段：result/contract/both |

唯一约束：`(hospital_id, project_code)`

### ProcurementIntent（采购意向）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 |
| hospital_id | FK hospitals.id | 所属医院 |
| article_id | String(100) | 公告ID |
| title | String(500) | 公告标题 |
| intent_url | String(500) | 意向链接 |
| budget_price | Float | 预算金额（元） |
| purchase_name | String(255) | 采购单位 |
| district_name | String(100) | 区县 |
| device_category | String(20) | 设备类别 |
| publish_date | DateTime | 发布日期 |

唯一约束：`(hospital_id, article_id)`

### Contact（联系人）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 |
| hospital_id | FK hospitals.id | 所属医院 |
| name | String(100) | 姓名 |
| position | String(100) | 职位 |
| contact_info | String(500) | 联系方式 |

唯一约束：`(hospital_id, name)`

### ContactNote（联系人备注）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增 |
| contact_id | FK contacts.id | 所属联系人 |
| content | Text | 备注内容 |
| updated_by | String(100) | 更新人 |

## Staging 机制

所有可批量导入的实体（devices、maintenance_devices、bid_wins、procurement_intents）均有 staging + backup 表。

标准流程：
1. `import --dry-run` 预览
2. `import --staging` 写入暂存表
3. `staging-info` 确认数据量
4. `diff` 对比差异
5. `switch --yes` 合并到生产（自动备份原数据到 backup）
6. `rollback --yes` 回退（backup 恢复到生产）

## 数据导入

- `hospitals import --file <xlsx> --source {l10,l2}` — 授权公立医院 Excel
- `devices import --file <xlsx>` — CDI Report Excel
- `maintenance import --file <xlsx>` — weixiu.xlsx
- `bids` — 由 device_procurement 爬虫自动写入 staging
