# Product Readiness Layering Test Plan

Date: 2026-06-01

## Scope

Validate that the product surface exposes one collaboration concept, `编排`, and no longer splits the same idea across workflow, blueprint, and orchestration pages.

## Unit Tests

### Layout

- Sidebar renders `生产链路`, `构建与验收`, and `系统运维`.
- Production links include Chat, Sessions, enterprise people, digital employees, people binding, entry routing, and knowledge base.
- Build links include Builder, Harness, skills marketplace, and employee network.
- Production links include the single `编排` entry.
- Memory is placed under system operations.
- Expanded navigation shows capability tier badges.

### Agent Builder

- Page title is `数字员工 Builder`.
- Test action reports `模拟 Harness 已通过`.
- Editing a tested draft still clears the harness result and disables publishing until retested.
- `GET /api/agent-builder/drafts/:id/capabilities` returns the draft capability assembly before publish.
- Review panel shows `能力装配摘要` using backend capability data.

### Harness

- Page title is `验收 Harness`.
- Suite execution still calls `/api/admin/harness/run-suite`.
- `POST /api/admin/harness/run-step` dispatches one StepRun through `MessageIngressRuntime`.
- `GET /api/admin/harness/step-runs` lists StepRun state.
- Harness page shows `长任务 StepRun`.

### Orchestration

- Page title is `编排`.
- Copy states that the page is reconstructed from real entry messages, routing, and handoff records.
- Pipeline aria-label is `编排 Trace 视图`.
- Page does not expose `工作流蓝图`, `流程指引`, `编排参考`, or `WorkflowRun 状态` as separate concepts.
- Page loads traces through `/api/orchestration/traces`.
- `/workflows` is not registered as a product route.

### Capability Registry

- `GET /api/admin/capabilities?tenant=...` returns one report per digital employee.
- Reports include prompt source, workspace health, skills, tools, handoff targets, MCP boundary, and warnings.
- `GET /api/admin/capabilities/:tenant/:employeeId` returns a single report or 404.
- Web page `/capabilities` lists employees, shows summary metrics, and exposes the selected employee's skill/tool/permission/workspace boundary.
- Sidebar includes `员工配置` under `构建与验收`.

## Manual Smoke

1. Open `http://localhost:8888`.
2. Confirm the sidebar no longer has `蓝图/实验` and has one `编排` entry.
3. Open `员工配置` and verify each employee shows skills, tools, workdir, handoff targets, and MCP boundary.
4. Open Builder and verify Skills, Tools, prompt, workspace, schedule, and allowed targets are still editable.
5. Open Harness and run the full suite.
6. Open `编排` and confirm the page reads as trace observation, not a separate workflow or blueprint product.

## Out Of Scope

This test plan does not validate the deferred proactive orchestration runtime. That requires a separate spec for gate state, retries, scheduling, and persistence.
