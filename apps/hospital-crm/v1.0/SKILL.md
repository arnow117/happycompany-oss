---
name: hospital-crm
description: 医疗器械 CRM 管理 — 医院、设备、维保、中标、采购意向、联系人、供应商分析
argumentHint: <command> [args]
allowedTools:
  - Read
  - Write
  - Bash
  - Glob
userInvocable: true
---

# Hospital CRM

医疗器械 CRM 系统。管理医院档案、装机设备、维保合同、中标信息、采购意向和客户联系人。

## 数据概况

```
bin/run info
```

## 可用命令

通过 `bin/run <command>` 执行。所有导入命令支持 staging 机制：`--dry-run` 预览、`--staging` 写暂存、`switch` 合并生产、`rollback` 回退。

### 医院管理 (`hospitals`)

| 命令 | 说明 |
|------|------|
| `hospitals list [--province P] [--city C] [--channel CH]` | 列出医院（最多50条） |
| `hospitals show <id>` | 查看医院详情 |
| `hospitals import --file <xlsx> --source {l10,l2} [--dry-run]` | 从 Excel 导入 |
| `hospitals update <id> [--province] [--city] [--channel] [--notes]` | 更新医院信息 |
| `hospitals delete <id> [--yes]` | 删除医院 |

### 设备管理 (`devices`)

| 命令 | 说明 |
|------|------|
| `devices list [--hospital-id ID] [--brand B] [--category C]` | 列出设备 |
| `devices show <id>` | 查看设备详情 |
| `devices import --file <xlsx> [--dry-run] [--staging]` | 导入设备（staging 流程） |
| `devices update <id> [--brand] [--product-name] [--category] [--product-tier]` | 更新设备 |
| `devices delete <id> [--yes]` | 删除设备 |
| `devices staging-info` | 查看三表数据概况 |
| `devices diff` | 对比 staging 与生产差异 |
| `devices switch [--yes]` | staging 合并到生产（自动备份） |
| `devices rollback [--yes]` | 从备份恢复 |
| `devices backup` | 手动备份 |

### 维保管理 (`maintenance`)

| 命令 | 说明 |
|------|------|
| `maintenance list [--hospital-id ID] [--expiring-before YYYY-MM-DD]` | 列出维保设备 |
| `maintenance show <id>` | 查看维保详情 |
| `maintenance import --file <xlsx> [--dry-run] [--staging]` | 导入维保数据 |
| `maintenance update <id> [--brand] [--contract-start] [--contract-end] [--planned-count N] [--completed-count N]` | 更新维保 |
| `maintenance delete <id> [--yes]` | 删除维保 |
| `maintenance staging-info` | 查看三表数据概况 |
| `maintenance diff` | 对比 staging 与生产差异 |
| `maintenance switch [--yes]` | staging 合并到生产 |
| `maintenance rollback [--yes]` | 从备份恢复 |

### 中标信息 (`bids`)

| 命令 | 说明 |
|------|------|
| `bids list [--hospital-id ID] [--supplier S] [--days N]` | 列出中标信息 |
| `bids show <id>` | 查看中标详情 |
| `bids delete <id> [--yes]` | 删除中标记录 |
| `bids staging-info` | 查看三表数据概况 |
| `bids diff` | 对比差异 |
| `bids switch [--yes]` | staging 合并到生产 |
| `bids rollback [--yes]` | 从备份恢复 |

### 采购意向 (`intents`)

| 命令 | 说明 |
|------|------|
| `intents list [--hospital-id ID] [--device-category C]` | 列出采购意向 |
| `intents show <id>` | 查看意向详情 |
| `intents staging-info` | 查看三表数据概况 |
| `intents switch [--yes]` | staging 合并到生产 |
| `intents rollback [--yes]` | 从备份恢复 |

### 联系人 (`contacts`)

| 命令 | 说明 |
|------|------|
| `contacts list [--hospital-id ID]` | 列出联系人 |
| `contacts show <id>` | 查看联系人及备注 |
| `contacts add <hospital_id> --name <N> [--position] [--contact-info]` | 添加联系人 |
| `contacts update <id> [--position] [--contact-info]` | 更新联系人 |
| `contacts delete <id> [--yes]` | 删除联系人 |
| `contacts note add <contact_id> --content <TEXT> [--updated-by]` | 添加备注 |
| `contacts note list <contact_id>` | 列出备注 |

### 聚合查询 (`query`)

| 命令 | 说明 |
|------|------|
| `query hospital <name_or_id>` | 医院全景（设备+维保+中标+联系人） |
| `query supplier <name>` | 供应商中标分析 |
| `query expiring <days>` | 即将到期的维保设备 |

### 供应商 (`suppliers`)

| 命令 | 说明 |
|------|------|
| `suppliers list [--limit N]` | 供应商列表及中标统计 |
| `suppliers show <name>` | 供应商详情 |

### 全局搜索

```
bin/run search <keyword> [--dim {hospital,device,maintenance,bid,contact}]
```

### AI 表格同步 (`aitable`)

```
bin/run aitable sync [-t {hospitals,devices,maintenance,bids,intents}] [--dry-run]
```

## 数据导入标准流程

```
1. bin/run <entity> import --file data.xlsx --dry-run    # 预览
2. bin/run <entity> import --file data.xlsx --staging     # 写入暂存
3. bin/run <entity> staging-info                          # 确认数量
4. bin/run <entity> diff                                  # 对比差异
5. bin/run <entity> switch --yes                          # 合并到生产
```

回退：`bin/run <entity> rollback --yes`
