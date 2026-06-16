# E2E Diff Review Checklist

Use this checklist after each feature iteration, UI/workflow bug fix, route change, release, demo, or stakeholder review request.

## 1. Trigger

- [ ] Feature iteration
- [ ] UI / workflow bug
- [ ] Route or information architecture change
- [ ] Release / demo / stakeholder review
- [ ] E2E cleanup

## 2. Product Story Impact

- [ ] What user value changed?
- [ ] Which business story does it belong to?
- [ ] Does this need a Journey story card?
- [ ] Does this need product-facing report evidence?

## 3. Add / Update / Delete / Reclassify

- [ ] **Add**: new workflow, user value, interaction state, or real bug.
- [ ] **Update**: existing value remains, but route, copy, API contract, or interaction changed.
- [ ] **Delete**: removed page, replaced flow, stale implementation detail, or no current user value.
- [ ] **Reclassify**: Probe to Mainline/Journey, broad Mainline to Journey, stale Journey to delete.

## 4. Layer Choice

- [ ] Mainline: should block ordinary development if broken.
- [ ] Journey: tells a feature, iteration, or full-chain story with screenshots.
- [ ] Probe: explores button, form, dialog, filter, tenant switch, loading, network, or observability risk.
- [ ] Bug Replay: minimal reproduction for a real bug.

## 5. Verification

- [ ] `cd web && npm run test:e2e:mainline -- --list`
- [ ] `cd web && npm run test:e2e:probe -- --list`
- [ ] `cd web && npm run test:e2e:report -- --list`
- [ ] Run targeted suite.
- [ ] Run full mainline when relevant.

## 6. Report

- [ ] Playwright HTML exists for engineering drill-down.
- [ ] Product story HTML is generated when user/stakeholder review is requested.
- [ ] Journey screenshots are linked or embedded.
- [ ] Gaps and next recommended Journey/Probe are listed.
