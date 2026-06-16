# happycompany — project task runner
# Usage:  just --list

mod server 'server.just'
mod web 'web.just'

# ─── Aggregate (auto-detect touched domains) ───────────────────────

# Fast commit-level checks. Only runs checks for domains with uncommitted/staged changes.
check:
    #!/usr/bin/env bash
    set -euo pipefail
    changed=$( { git diff --name-only HEAD; git diff --name-only --cached; } | sort -u )
    if [ -z "$changed" ]; then
        echo "No uncommitted/staged changes. Stage or modify files first." >&2
        exit 1
    fi
    ran=0
    if echo "$changed" | grep -Eq '^(src/|tests/|package.json|tsconfig.json|vitest.config.ts|server.just|justfile)'; then
        echo "=== server domain changed ==="
        just server check
        ran=1
    fi
    if echo "$changed" | grep -Eq '^(web/|justfile|web.just)'; then
        echo "=== web domain changed ==="
        just web check
        ran=1
    fi
    if [ "$ran" -eq 0 ]; then
        echo "Changes detected but not in a tracked domain. Skipping."
    fi

# Full push-level checks for all touched domains (vs origin/main).
pre-pr:
    #!/usr/bin/env bash
    set -euo pipefail
    changed=$(git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD)
    if [ -z "$changed" ]; then
        echo "No changes vs origin/main." >&2
        exit 1
    fi
    ran=0
    if echo "$changed" | grep -Eq '^(src/|tests/|package.json|tsconfig.json|vitest.config.ts|server.just|justfile)'; then
        echo "=== server domain ==="
        just server pre-pr
        ran=1
    fi
    if echo "$changed" | grep -Eq '^(web/|justfile|web.just)'; then
        echo "=== web domain ==="
        just web pre-pr
        ran=1
    fi
    if [ "$ran" -eq 0 ]; then
        echo "Changes detected but not in a tracked domain. Skipping."
    fi

# ─── Full checks (all domains, always) ─────────────────────────────

# Full check across all domains. Use before merge.
check-all:
    just server check
    just web check

# Full pre-pr across all domains + consistency audit. Mirrors CI.
pre-pr-all:
    just server pre-pr
    just web pre-pr
    just consistency

# ─── Consistency ────────────────────────────────────────────────────

# Run design-vs-implementation consistency audit.
consistency:
    bash scripts/consistency-check.sh

# Full milestone review: consistency + CLAUDE.md staleness + debt sweep.
review: consistency
    #!/usr/bin/env bash
    set -euo pipefail
    echo ""
    echo "=== CLAUDE.md Staleness Check ==="
    for f in CLAUDE.md src/CLAUDE.md src/orchestrator/CLAUDE.md web/CLAUDE.md; do
        last_commit=$(git log -1 --format="%ar" -- "$f" 2>/dev/null || echo "never")
        echo "  $f — last updated: $last_commit"
    done
    echo ""
    echo "=== Debt Sweep ==="
    grep -rn "FIXME\|TODO\|HACK\|XXX" src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v node_modules | head -20 || echo "  No debt markers found."
    echo ""
    echo "Review checklist (manual):"
    echo "  [ ] Each CLAUDE.md rule: still holds? agent still needs it? inferable from code?"
    echo "  [ ] Any CLAUDE.md file grown too long? Move content out."
    echo "  [ ] Any new architectural constraint not yet in CLAUDE.md?"
    echo "  [ ] Any stale CLAUDE.md references to deleted files?"
    echo "  [ ] Consistency check warnings addressed?"
    echo "  [ ] Debt items from last review resolved?"

# ─── Setup ──────────────────────────────────────────────────────────

# Enable git hooks for this repo.
setup-hooks:
    git config core.hooksPath .githooks
    @echo "Git hooks enabled: .githooks/"

# ─── E2E & Data ─────────────────────────────────────────────────────

# Run stable Playwright Mainline E2E tests.
e2e:
    cd web && npm run test:e2e:mainline

# Run stable Playwright Mainline E2E tests.
e2e-mainline:
    cd web && npm run test:e2e:mainline

# Run focused exploratory Probe E2E tests.
e2e-probe:
    cd web && npm run test:e2e:probe

# Run screenshot Journey E2E reports.
e2e-report:
    cd web && npm run test:e2e:report

# Seed E2E test data.
seed-e2e:
    node scripts/seed-e2e.mjs
