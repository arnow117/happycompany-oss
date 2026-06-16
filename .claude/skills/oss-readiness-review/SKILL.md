---
name: oss-readiness-review
description: >
  Review and improve a codebase for open-source readability, clean architecture,
  and enterprise/FDE deployment readiness. Use when asked to make the project
  cleaner for OSS, prepare for enterprise deployment, separate platform code
  from tenant/customer data, audit hardcoded tenant paths, improve README or
  onboarding, add readiness checklists, or run an OSS/enterprise readiness pass.
---

# OSS Readiness Review

Use this skill to turn "the project feels messy" into a repeatable engineering pass.
The goal is not cosmetic cleanup; it is to make the repository understandable,
safe to open-source, and practical to deploy inside an enterprise.

## Operating Mode

Default to action. Inspect the repository, list concrete findings, fix safe issues,
run focused verification, then summarize remaining risks. Do not rewrite unrelated
product work or revert user changes.

If the worktree is dirty, identify which files are already modified before editing.
Only change files needed for the readiness pass.

## Fast Evidence Scan

From the project root, run:

```bash
.claude/skills/oss-readiness-review/scripts/scan.sh
```

Use the scan as evidence, not as a substitute for judgment.

## Review Pipeline

### 1. Platform and Tenant Boundary

Answer these first:

- What belongs in the platform repo?
- What belongs in an external/private tenant data directory?
- Which examples are safe demo fixtures?
- Which runtime state should never be committed?

Check:

- `.gitignore` blocks real tenant directories and runtime data.
- `corp/templates/` or equivalent template sources are the only platform-owned tenant-like data.
- Real tenants live outside the repo, for example under `../corp/{tenant}` or a configured `corpDir`.
- `config.example.json` uses placeholders or demo tenants, not real customer names.
- Docs do not expose local absolute paths, customer names, secrets, or deployment-specific state unless explicitly marked internal.

### 2. Hardcoded Runtime Assumptions

Search for hardcoded tenants, paths, ports, and role IDs:

```bash
rg -n "acme|acme|corpDir|/Users/|tenant:|tenantId|localhost|127\\.0\\.0\\.1" .
```

Classify each match:

- `demo-ok`: safe fixture, example, or test data.
- `config-needed`: should be supplied by config, env, selected tenant, or request context.
- `leak`: real customer/local/private detail in public-facing code or docs.

Fix `config-needed` and `leak` items when the intended source of truth is clear.

### 3. Architecture Cleanliness

Look for places where future contributors or AI sessions will get lost:

- Routes doing business logic that belongs in service modules.
- Config parsing split across multiple ad hoc call sites.
- Tenant directory resolution duplicated instead of centralized.
- UI pages knowing backend filesystem details.
- Shared flows lacking tests at API boundaries.
- Large files hiding multiple responsibilities.

Prefer small, local improvements over broad refactors. If a larger refactor is needed,
write the target shape and leave it as a tracked follow-up unless the user asked to do it now.

### 4. OSS Onboarding

Evaluate the first 10 minutes for a new contributor:

- README explains what the project is in one screen.
- Quick Start creates or uses a demo tenant with one command.
- Required ports and services are explicit.
- Tests and build commands are copy-pasteable.
- `CONTRIBUTING.md`, `SECURITY.md`, and license metadata exist where appropriate.
- CI exists or the missing CI is called out as a release blocker.

When improving docs, keep public docs generic. Put machine-local notes in project-agent
instructions only when they are intentionally local.

### 5. Enterprise/FDE Deployment Readiness

Check whether a customer deployment can be operated without editing source code:

- Tenant root is configurable by env/config.
- Tenant import/export or copy workflow is documented.
- Platform state directory and tenant data directory are separate.
- Health checks and smoke tests exist.
- Backup, restore, and migration responsibilities are documented.
- Multi-tenant switching is clear in both API and UI.
- Demo/test tenants cannot accidentally point at real customer data.

### 6. Verification

Choose the narrowest verification that proves the changes:

```bash
npx tsc --noEmit
npx vitest run
cd web && npm run build
cd web && npx playwright test
```

For documentation-only changes, at minimum run the scan script and verify links/paths
with `rg`. For frontend behavior changes, build and run the relevant Playwright tests.

## Output Format

Lead with findings when doing review-only work:

```markdown
**Findings**
- P1 [file:line] Issue. Impact. Suggested fix.

**Safe Fixes Made**
- ...

**Verification**
- ...

**Remaining Risks**
- ...
```

Lead with completed changes when the user asked you to implement:

```markdown
Implemented the OSS/enterprise readiness pass.

Changed:
- ...

Verified:
- ...

Still worth doing:
- ...
```

## Priority Guide

- `P0`: private customer data, secrets, or destructive deployment risk.
- `P1`: hardcoded tenant/path/config that blocks enterprise deployment or OSS use.
- `P2`: confusing onboarding, missing docs, missing test coverage for changed surfaces.
- `P3`: polish, naming, or future maintainability improvements.

