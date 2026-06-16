# happycompany — server checks
# Implementation: calls npm scripts or raw npx tools

# Fast commit-level check (~3s). TypeScript only.
check:
    npm run typecheck

# Full push-level check (~30s). TypeScript + tests.
pre-pr: check
    npm run test
    npm run harness:fake

# Run deterministic Harness acceptance cases.
harness:
    npm run harness:fake

# Run Harness cases against a running backend. Pass extra CLI args after `--`.
harness-real *ARGS:
    npm run harness:real -- {{ARGS}}

# Type-check only.
typecheck:
    npm run typecheck

# Run all server tests.
test:
    npm run test

# Run tests with coverage report.
coverage:
    npm run test:coverage
