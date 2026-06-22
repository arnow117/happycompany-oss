# Contributing to HappyCompany

Thanks for your interest in contributing! This guide covers local setup, the
test workflow, and how to land a change.

## Prerequisites

- **Node.js ≥ 20** (CI runs on Node 24; see `.nvmrc`)
- **npm**
- **Python 3** (only for the demo `med_crm` skill / tenant tools)

## Setup

```bash
git clone https://github.com/arnow117/happycompany-oss.git
cd happycompany-oss
npm ci
npm --prefix web ci
```

No hand-written config is required to run the tests — the suites materialize
their config from committed examples (`config.test.example.json`,
`config.e2e.example.json`) and build `web/dist` on demand.

To run the app locally, create `config.json` from the example and set a model key:

```bash
cp config.example.json config.json   # then edit claude.apiKey / baseUrl / model
npm run dev                            # backend on :3100 (serves web/dist)
cd web && npm run dev                  # frontend dev server on :8888
```

`config.json`, `config.e2e.json`, and `data/` are gitignored — never commit secrets.

### Model configuration

The agent uses the Claude Agent SDK and works with Anthropic or any
Anthropic-compatible gateway via `claude.baseUrl` / `claude.authToken` /
`claude.model`. Native Claude (or a Claude-serving gateway) is the most reliable
for the agent loop; OpenAI-shaped relays may be slower or incompatible with the
agentic tool/streaming protocol.

## Tests

```bash
npm test                       # backend unit + integration (auto-builds web/dist, boots a sandbox server)
npm --prefix web test          # frontend component tests
cd web && npm run test:e2e:mainline   # Playwright E2E (needs browsers: npx playwright install)
npm run harness:fake           # fixture-based acceptance harness (no model)
```

A clean checkout should be fully green with `npm test` + `npm --prefix web test`.
CI (`.github/workflows/ci.yml`) runs typecheck + build + both test suites, plus a
Playwright E2E job in the official Playwright container.

There is also an opt-in real-model WebSocket round-trip test, skipped by default:

```bash
HC_REAL_WS_TEST=1 ANTHROPIC_AUTH_TOKEN=... ANTHROPIC_BASE_URL=... HC_REAL_WS_MODEL=... \
  npx vitest run tests/real-ws-chat.test.ts
```

## Before opening a PR

```bash
just check     # fast checks for touched domains
just pre-pr    # full tsc + build + tests for touched domains
```

(`just --list` shows all recipes. Plain npm equivalents are above if you don't use `just`.)

- Ensure typecheck, build, and tests pass.
- Keep the working tree clean — tests must not leave tracked files modified.
- Follow the architecture notes and prohibitions in `CLAUDE.md`, `src/CLAUDE.md`,
  `src/orchestrator/CLAUDE.md`, and `web/CLAUDE.md`.

## Commit messages

Conventional Commits:

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

## Coding conventions

- TypeScript strict; no new `any` (use `unknown` + narrowing).
- No `console.log` in production code — use the logger (Pino).
- Don't import `orchestrator/` internals from outside; go through
  `orchestrator-runner.ts` / `employee-api.ts`.
- Many small, focused files over large ones.

## License

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
