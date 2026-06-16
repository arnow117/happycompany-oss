# Web E2E

Web E2E is organized by purpose, not only by page. Keep the default suite stable, and use focused journey reports when validating a feature, iteration, or full product flow.

## Suites

| Suite | Purpose | Command |
|-------|---------|---------|
| Mainline | Current platform regression | `npm run test:e2e:mainline` |
| Journey Report | Feature/iteration/full-flow report with screenshots | `npm run test:e2e:report` |
| Probe | Focused bug reproduction or exploratory interaction check | `npm run test:e2e:probe` |

## Mainline

The default mainline suite is configured in `../playwright.config.ts`. It currently includes:

- `story-bootstrap`
- `story-config-page`
- `story-h-sessions`
- `story-q-chat-websocket`
- `story-v2-*`

Mainline specs should be deterministic and stable. Prefer assertions on user-visible outcomes, route behavior, API protocol, and durable states. Screenshots are captured on failure.

## Journey Report

Journey specs are for product validation and iteration reports. They should tell a complete story:

1. Set up a realistic tenant/profile or explicit mocks.
2. Enter through a user-visible route.
3. Exercise the primary workflow.
4. Capture screenshots at important states.
5. Attach the screenshots to the Playwright HTML report.

Use this shape for new reports:

```text
journey-{feature-or-iteration}/journey.spec.ts
```

Use `reporting.ts` for screenshots:

```ts
import { test, expect } from '@playwright/test';
import { createJourneyReport } from '../reporting';

test('publishes a digital employee', async ({ page }, testInfo) => {
  const report = createJourneyReport(testInfo, {
    slug: 'agent-builder-publish',
    title: 'Agent Builder Publish Journey',
  });

  await page.goto('/agent-builder');
  await expect(page.getByRole('heading', { name: '数字员工 Builder' })).toBeVisible();
  await report.capture(page, 'empty-builder', 'Empty Builder');
  await report.writeSummary({ status: 'passed' });
});
```

Run reports with:

```bash
npm run test:e2e:report
```

Playwright HTML is the engineering drill-down report. For stakeholder review, create a product-facing story report in `docs/reports/` that explains the tested business stories first, then links back to Playwright details.

## Probe

Use probes when fixing a bug or exploring a risky interaction. A probe can be narrow and focused:

```text
probe-{issue-or-risk}/probe.spec.ts
```

Current examples:

- `probe-config-editing`: masked secrets, model connection test, and Web Chat copy save.
- `probe-enterprise-people-binding`: sync people, assign role, and bind personal assistant.
- `probe-layout-shell`: sidebar collapse/expand, tenant switch, theme toggle, logout, and mobile menu.
- `probe-knowledge-interactions`: knowledge tier tabs and delete dialog cancel/confirm states.
- `probe-memory-editor`: subject switch, search/clear, file open, edit/cancel/save, and back navigation.
- `probe-orchestration-interactions`: workflow case search, empty state, and timeline detail switching.

After the fix, either migrate the probe into Mainline/Journey or delete it if it only served diagnosis. Do not silently add flaky probes to the default mainline suite.

Run probes with:

```bash
npm run test:e2e:probe
```

## Bug Replay

When a bug is found by clicking through the UI, turn it into a minimal Probe first:

1. Write a failing reproduction.
2. Confirm it fails for the right reason.
3. Fix the product code.
4. Re-run the Probe and relevant Mainline/Journey.
5. Promote the Probe if it protects current product value; otherwise delete it.

## E2E Diff Review

After every product iteration, review E2E as add/update/delete/reclassify:

- Add tests for new user value, workflows, interaction states, and real bugs.
- Update tests when current value remains but route, copy, data, or interaction changed.
- Delete tests for removed routes, replaced flows, old implementation details, or missing current user value.
- Reclassify Probe/Bug Replay into Mainline/Journey when it becomes durable product coverage.

## Product Story Report

Generate a product-facing report skeleton from current E2E directories, story cards, coverage matrix, and stable screenshots:

```bash
# From the repository root
npm run e2e:story-report
```

The generated HTML is a stakeholder-facing starting point. Keep Playwright HTML as drill-down evidence, not the primary review surface.
