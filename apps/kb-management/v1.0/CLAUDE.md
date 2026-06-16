# kb-management — 开发指导

## 知识库架构

知识库采用纯文件方案，利用 Claude 的文件读写能力进行文档管理。

### 目录

- 知识根目录：`{workdir}/knowledge/`
- 知识卡片：`{workdir}/knowledge/cards/*.md`
- 索引文件：`{workdir}/knowledge/index.md`

### 知识卡片格式

每张知识卡片是一个 Markdown 文件，包含：
- 标题（H1）
- 元数据（blockquote：来源、创建时间、标签）
- 正文内容

### 入库流程

1. 用户发送文本/文件给 bot
2. Claude 提取关键信息，整理为结构化知识卡片
3. 写入 `knowledge/cards/{slug}.md`
4. 更新 `knowledge/index.md` 索引条目

### 查询流程

1. 读取 `knowledge/index.md` 获取知识结构概览
2. 根据用户问题关键词，用 Glob 匹配相关卡片
3. 读取匹配的卡片内容
4. 综合回答，标注来源

### 注意事项

- 知识卡片文件名用 kebab-case（如 `device-maintenance.md`）
- 索引文件是知识库的入口，必须保持更新
- 大文件（>100KB）应摘要化后入库，不存储原文
