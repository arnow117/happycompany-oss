# happycompany — web checks
# Implementation: calls npm/cd into web/

# Fast commit-level check (~5s). TypeScript + build.
check:
    cd web && npm run typecheck && npm run build

# Full push-level check. TypeScript + build + tests + stable E2E mainline.
pre-pr: check
    cd web && npm run test
    cd web && npm run test:e2e:mainline

# Build for production.
build:
    cd web && npm run build

# Type-check only.
typecheck:
    cd web && npm run typecheck

# Start Vite dev server (8888).
dev:
    cd web && npm run dev

# Run web tests.
test:
    cd web && npm run test

# Run stable E2E mainline.
e2e-mainline:
    cd web && npm run test:e2e:mainline

# Run focused E2E probes.
e2e-probe:
    cd web && npm run test:e2e:probe

# Run Journey screenshot reports.
e2e-report:
    cd web && npm run test:e2e:report
