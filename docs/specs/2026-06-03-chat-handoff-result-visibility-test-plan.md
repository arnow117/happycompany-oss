# Chat Handoff Result Visibility Test Plan

**Date**: 2026-06-03

## Overview

Expose real multi-agent handoff lifecycle in Chat streaming UI: when a child contract completes or fails, the current chat shows the delegated agent's result instead of requiring database inspection.

## Test Strategy

- Backend unit coverage: orchestration runner publishes stream events for child contract completion/failure with chat identity.
- Frontend store coverage: stream events update collaboration state with status and result text.
- Frontend component coverage: collaboration card renders pending/completed/failed states and the delegated result summary.

## New Cases

- Handoff event creates a pending collaboration entry.
- Handoff result event updates the matching collaboration to completed and stores the result text.
- Handoff failure event updates the matching collaboration to failed.
- The streaming display shows completed delegated results without waiting for the final parent summary.

## Verification Commands

```bash
env VITEST_SKIP_GLOBAL_SETUP=1 npx vitest run tests/orchestrator/orchestrator-runner.test.ts tests/orchestrator/handoff.test.ts tests/orchestrator/employee-colony.test.ts tests/ingress/runtime.test.ts tests/routes/runtime-routes.test.ts
cd web && npm run build
cd web && npx vitest run src/components/chat/ChatView.test.tsx src/components/chat/MessageInput.test.tsx src/pages/Chat.test.tsx
```
