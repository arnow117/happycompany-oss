# E2E Journey Story Card: Harness Acceptance

## Story

- **Name**: Harness Acceptance
- **Owner/Reviewer**: Product + Engineering
- **Date**: 2026-06-04
- **Status**: Implemented

## Product Value

- **User**: 交付工程师 / QA / 平台管理员
- **Business goal**: 用 Harness 对员工能力或工作流进行可重复验收。
- **Why this should be Journey rather than Mainline/Probe**: Harness 是验收工具本身，报告要能展示测试对象、运行结果和失败定位。

## Flow Boundary

- **Start state**: 存在 harness cases。
- **End state**: suite 和单 step run 完成并展示报告。
- **Primary route**: `/harness`
- **Related routes**: `/orchestration`, `/agent-builder`

## Scenario

1. 选择 tenant 和 case。
2. 运行 suite。
3. 运行单个 workflow step 并查看结果。

## Expected Evidence

- **Screenshot 1**: Harness cases 列表。
- **Screenshot 2**: Suite run result。
- **Screenshot 3**: Step run details。
- **Summary assertions**: case 可见、suite 可跑、step 可跑、结果可读。

## Data Boundary

- **Real profile data required**: 可使用 e2e fixture cases。
- **Mocked data**: latest report 和 step runs 可 mock。
- **Tenant / actor / employee assumptions**: `acme-happycompany`。

## Coverage Links

- **Mainline coverage**: `story-v2-harness`
- **Probe coverage**: 暂无，后续只在 Harness 表单校验或错误态出现 bug 时补。
- **Bug replay links**: 暂无

## Open Risks

- 当前已具备截图型 Journey；真实 Harness fixture 质量仍由后端 harness suite 保障。
