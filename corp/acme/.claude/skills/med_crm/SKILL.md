---
name: med_crm
description: 示例医疗医院客户、设备、维保、招投标、合同录入、维修回执和财务结算工具。
---

# 医院 CRM

使用 `run_skill` 调用此技能的结构化命令。平台运行时从同目录的 `tools.json`
读取 command schema 和风险等级，并从本 skill package 内执行 Python 入口。

## Acme acceptance commands

- `search_bids`: 查询杭州示例医疗等中标记录。
- `contract_intake`: 录入合同字段，写入 `contract_intakes`，并生成 `maintenance_schedules`。
- `add_incident`: 记录维修工单或现场问题。
- `create_service_record`: 记录维修日志和 SERVICE RECORD 回执。
- `finance_settlement`: 记录回执后的结算和归档状态。

写入命令会在 `ACME_CRM_DB` 指向的 SQLite 数据库中创建最小业务表。真实租户启用前必须确认角色授权和数据目录隔离。
