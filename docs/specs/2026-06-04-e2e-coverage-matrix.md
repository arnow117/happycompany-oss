# E2E Coverage Matrix

**日期**: 2026-06-04
**状态**: Draft

## Summary

当前 E2E 已有 Mainline / Journey / Probe 分层，核心运行链路已具备报告型 Journey 覆盖。本矩阵用于后续迭代做 Add / Update / Delete / Reclassify。

| Product Story | Mainline | Journey | Probe | Current Status | Next Action |
|----------------|----------|---------|-------|----------------|-------------|
| Employee Activation | `story-v2-product-journey`, `story-q-chat-websocket`, `story-h-sessions` | `journey-employee-activation` | `probe-enterprise-people-binding` | Implemented baseline | Deepen Journey with real publish clicks when needed |
| First Run Enterprise Initialization | `story-bootstrap`, `story-v2-product-journey` | Missing | Covered indirectly by `probe-config-editing` | Partial | Add report Journey when onboarding changes |
| Entry Channel Configuration | `story-config-page` | Missing | `probe-config-editing` | Partial | Add Journey when channel onboarding changes |
| Chat Collaboration Handoff | `story-q-chat-websocket`, `story-v2-product-journey` | `journey-chat-collaboration-handoff` | Covered by protocol mainline | Implemented | Add focused Chat UI boundary Probe only when new bugs appear |
| Session Runtime Review | `story-h-sessions`, `story-v2-product-journey` | `journey-session-runtime-review` | `probe-orchestration-interactions` | Implemented | Keep selectors aligned if Sessions a11y labels are fixed |
| Knowledge And Memory Management | Missing | Missing | `probe-knowledge-interactions`, `probe-memory-editor` | Probe only | Promote to Journey if product priority rises |
| Harness Acceptance | `story-v2-harness` | `journey-harness-acceptance` | Missing | Implemented | Add Probe only for Harness form validation bugs |
| Multi Tenant Isolation | Partial in `story-v2-product-journey` | `journey-multi-tenant-isolation` | `probe-layout-shell` | Implemented | Expand with backend profile isolation when runtime profile changes |
| Skill Marketplace Package View | Missing | Missing | `probe-skill-marketplace-package` | Probe only | Add Journey only if marketplace becomes a release focus |
| Console Overview | Missing | `journey-console-overview` | N/A | Implemented sample | Keep as report-mode sample |

## Gaps By Priority

1. First-run enterprise initialization report Journey, only when onboarding changes.
2. Entry/channel configuration report Journey, only when channel onboarding becomes release focus.
3. Knowledge and memory Journey, only if knowledge/memory becomes a core reviewed capability.
4. Skill marketplace Journey, only if marketplace becomes a release focus.
5. Employee Activation Journey can be deepened from key-state mock to real publish-click flow when Builder UX stabilizes.

## Automation

Product-facing report generation is available through:

```bash
npm run e2e:story-report
```

The generated report scans `web/e2e/`, story cards, the coverage matrix, and stable screenshot assets.

## Review Rule

Any frontend feature iteration must update this matrix when it changes coverage. If a row remains Partial for more than one product iteration and the story is still core, either implement the Journey/Probe or explicitly mark the gap accepted.
