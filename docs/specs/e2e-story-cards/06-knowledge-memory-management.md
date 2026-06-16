# E2E Journey Story Card: Knowledge And Memory Management

## Story

- **Name**: Knowledge And Memory Management
- **Owner/Reviewer**: Product + Engineering
- **Date**: 2026-06-04
- **Status**: Probe only

## Product Value

- **User**: 管理员 / 运营人员
- **Business goal**: 管理知识库和记忆文件，支持搜索、查看、编辑、删除。
- **Why this should be Journey rather than Mainline/Probe**: 知识和记忆共同影响数字员工长期能力，适合形成能力管理故事。

## Flow Boundary

- **Start state**: 存在知识卡片和 memory 文件。
- **End state**: 用户完成知识筛选/删除确认，以及 memory 搜索/编辑保存。
- **Primary route**: `/knowledge`
- **Related routes**: `/memory`

## Scenario

1. 在 Knowledge 查看三层知识并筛选。
2. 触发删除确认，验证取消和确认反馈。
3. 在 Memory 搜索文件，打开编辑，取消/保存并返回。

## Expected Evidence

- **Screenshot 1**: 知识库三层视图。
- **Screenshot 2**: 删除确认状态。
- **Screenshot 3**: Memory 编辑器保存状态。
- **Summary assertions**: 筛选正确、危险操作可取消、保存反馈可见。

## Data Boundary

- **Real profile data required**: 不强制。
- **Mocked data**: knowledge files/cards、memory sources/file content。
- **Tenant / actor / employee assumptions**: `acme-happycompany`, `web-bot`, `sales-zhangsan`。

## Coverage Links

- **Mainline coverage**: 暂无完整 Journey
- **Probe coverage**: `probe-knowledge-interactions`, `probe-memory-editor`
- **Bug replay links**: 暂无

## Open Risks

- Knowledge/Memory 目前更多是 Probe 样板，是否需要上升为 Journey 取决于产品优先级。
