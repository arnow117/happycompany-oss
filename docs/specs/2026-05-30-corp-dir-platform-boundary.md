# Platform Corp Directory Boundary

**日期**: 2026-05-30
**状态**: 已实现

## 背景

HappyCompany 主仓负责平台运行时与行业模板，企业实例负责具体客户的人、流程、业务工具、记忆和会话。为了支持 FDE 在客户环境部署，平台不能再隐式假设企业实例一定在仓库内 `corp/`。

## 决策

平台增加显式 corp root 解析：

1. `HAPPYCOMPANY_CORP_DIR`
2. `config.json.corpDir`
3. 仓库内 `corp/`
4. 上级 `../corp` 兼容路径

解析出的 corp root 同时承载：

```text
{corpRoot}/
├── templates/industries/   # 平台行业模板
└── {tenant}/               # 企业实例
```

生产部署推荐设置：

```bash
export HAPPYCOMPANY_CORP_DIR=/srv/happycompany/corp
```

## 企业实例最小结构

```text
{corpRoot}/{tenant}/
├── app.json
├── roles.json
├── people.json
├── employees/
├── agents/
├── apps/
├── workflows/
└── processes/
```

平台识别企业的最小条件是 `{corpRoot}/{tenant}/app.json` 存在。

## FDE 脚手架

`npm run fde:new` 使用同一套 corp root 解析，并额外支持 `--corp-dir <path>`。这保证“平台运行时扫描的目录”和“FDE 生成企业实例的目录”一致。

```bash
HAPPYCOMPANY_CORP_DIR=/srv/happycompany/corp npm run fde:new -- acme --from-template med-device
```
