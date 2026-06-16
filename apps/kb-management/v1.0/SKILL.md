---
name: kb-management
description: 知识库管理 — 文档入库、检索查询、知识卡片管理
argument-hint: <operation> [args]
allowedTools:
  - Read
  - Write
  - Bash
  - Glob
user-invocable: true
---

# Knowledge Base Management

管理和查询工作目录下的知识库。

## 知识目录

所有知识文件存储在 `{workdir}/knowledge/` 目录下。

### 目录结构

```
knowledge/
├── index.md          # 知识索引（自动生成/维护）
├── cards/            # 知识卡片目录
│   ├── device-maintenance.md
│   ├── product-specs.md
│   └── faq.md
└── uploads/          # 原始上传文件（可选）
```

## 操作

### ingest（入库）

读取用户提供的内容（文本、文件路径、URL 内容），整理为知识卡片存入 `knowledge/cards/` 目录。

知识卡片格式：

```markdown
# <标题>

> 来源：<来源说明>
> 创建时间：<ISO date>
> 标签：tag1, tag2

<正文内容>
```

入库后更新 `knowledge/index.md` 索引。

### query（查询）

1. 先读取 `knowledge/index.md` 了解知识库结构
2. 根据关键词定位相关卡片（Glob + Read）
3. 综合多个卡片内容回答用户问题
4. 引用来源卡片名称

### list（列表）

使用 Glob 列出 `knowledge/cards/*.md` 文件，返回文件名列表。

### delete（删除）

删除指定的知识卡片文件，并更新索引。
