---
name: happycompany-e2e
description: Use when designing, adding, updating, deleting, or reviewing HappyCompany Web E2E tests. Applies to feature iterations, bug fixes, interactive button/form probes, Playwright journey reports, screenshot reports, and E2E cleanup.
---

# HappyCompany E2E

Use this skill whenever a task touches Web E2E strategy or Playwright specs under `web/e2e/`.

## Core Principle

E2E validates the current product, not historical implementation. A stale E2E is deleted or rewritten; do not keep a parked archive of old stories in `web/e2e/`.

E2E is not only "scripted happy path". It should also cover the interactive surface where users find bugs by clicking buttons, toggles, dialogs, filters, and form controls.

## Test Types

| Type | Purpose | Location | Command |
|------|---------|----------|---------|
| Mainline | Stable current-platform regression | existing `story-*` matched by `web/playwright.config.ts` | `cd web && npm run test:e2e:mainline` |
| Journey | Feature/iteration/full-flow report with screenshots | `web/e2e/journey-{slug}/journey.spec.ts` | `cd web && npm run test:e2e:report` |
| Probe | Focused bug reproduction or exploratory interaction check | `web/e2e/probe-{slug}/probe.spec.ts` | `cd web && npm run test:e2e:probe` |
| Bug Replay | Minimal reproduction for a real bug | start as `probe-*`, then promote if durable | `cd web && npm run test:e2e:probe -- probe-{slug}` |

`test:e2e:gate` may exist as a compatibility alias, but prefer saying "mainline" in user-facing text.

## E2E Diff Review

For every product iteration, do not only add tests. Review E2E as a diff:

1. **Add**: new user value, new workflow, new interaction state, or newly discovered bug.
2. **Update**: current business value remains, but route, copy, data contract, or interaction changed.
3. **Delete**: page/route removed, flow replaced, test validates old implementation detail, or no current user value remains.
4. **Reclassify**: promote Probe/Bug Replay to Mainline; move a broad Mainline case to Journey; remove a Journey that no longer represents the product.

Deletion is healthy when the product changed. Do not leave dead specs or screenshot-only historical story folders.

## Mainline Rules

Mainline specs should be few, stable, and trusted:

- Assert user-visible outcomes, route behavior, protocol behavior, and durable state.
- Avoid brittle screenshot assertions.
- Avoid covering every button; use Probe for interaction exploration.
- Keep deterministic mocks or seeded E2E profile data.

Before adding a Mainline spec, ask: "Should this failure block ordinary development?"

## Journey Rules

Journey specs are product reports:

- One feature, iteration, or full chain per `journey-*` directory.
- Use `web/e2e/reporting.ts` to attach screenshots and summary to Playwright HTML.
- Capture key states, not every pixel.
- State whether data is explicit mock or real profile.

Required shape:

```text
web/e2e/journey-{feature-or-iteration}/journey.spec.ts
```

## Product Story Review Report

Playwright HTML is an engineering artifact, not the final stakeholder report. When the user asks to review "what stories are tested" or "what the result looks like", produce a product-facing HTML report under `docs/reports/`.

Required report shape:

- Start with product stories and user value, not test framework names.
- Group coverage by business capability, such as first-run setup, configuration, employee creation, chat collaboration, sessions, knowledge, memory, and shell interactions.
- Show status in plain language: what passed, what was exercised, what confidence it gives.
- Keep Playwright report links as drill-down evidence only.
- Include Journey screenshots when available.
- Include a short "what is still not covered" section.

Suggested path:

```text
docs/reports/{date}-e2e-story-review.html
```

Use `templates/story-review.html` as the starting structure when creating a new product-facing report.

## Journey Story Card

Before adding a broad Journey, write or update a story card. The story card keeps the test anchored to product value rather than page touring.

Use `templates/story-card.md` and include:

- User and business goal.
- Start state and done state.
- Main scenario and alternate paths.
- Screenshots that should appear in the report.
- Mock versus real data boundary.
- Related Mainline and Probe coverage.

## Probe Rules

Probe specs explore the interaction surface:

- Buttons: initial disabled/enabled state, click result, repeated click, loading click.
- Forms: empty required fields, invalid values, submit/cancel/reset.
- Dialogs: open, confirm, cancel, close, escape/overlay if supported.
- Selectors/tabs/filters: state changes, stale data, tenant switching.
- Network: backend error, timeout/slow loading, reconnect.
- Observability: toast, badge, logs, trace, session/handoff visibility.

Probe is where "I clicked a button and found a bug" becomes systematic.

Current repo examples:

- `probe-config-editing`: masked secrets, model connection test, Web Chat copy save.
- `probe-enterprise-people-binding`: sync people, assign role, bind personal assistant.
- `probe-layout-shell`: shell navigation, tenant selector, theme, logout, mobile menu.
- `probe-knowledge-interactions`: tab filtering plus confirm-dialog cancel/confirm flows.
- `probe-memory-editor`: selector, search, clear, editor cancel/save, and return navigation.
- `probe-orchestration-interactions`: workflow case search, empty state, and timeline detail switching.

## Bug Replay Workflow

When a user reports or discovers a UI bug:

1. Write the smallest failing Probe that reproduces the bug.
2. Run it and confirm it fails for the right reason.
3. Fix code.
4. Run the Probe and relevant Mainline/Journey.
5. Decide: promote, keep as focused replay, or delete if it only served diagnosis.

## Iteration Trigger Checklist

When a feature iteration, UI bug, route change, or release/demo request touches Web behavior, run `checklists/diff-review.md`.

Trigger rules:

- Feature iteration: run E2E Diff Review and decide Add / Update / Delete / Reclassify.
- UI or workflow bug: create the smallest Probe first, then fix, then promote or delete.
- Release, demo, or stakeholder review: run Journey and generate a product-facing story report.
- Route or IA change: update or delete stale stories in the same change.

## Commands

```bash
cd web
npm run test:e2e:mainline -- --list
npm run test:e2e:probe -- --list
npm run test:e2e:report -- --list
npm run test:e2e:report
```

Run full E2E only after the targeted suite is healthy.

For product-facing report generation:

```bash
# From the repository root
npm run e2e:story-report
```
