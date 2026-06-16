# ohmyappbuilder Integration Assessment

> 2026-05-03
> Scope: Practical integration options for the wish-to-build pipeline into happycompany

---

## 1. What ohmyappbuilder Does That happycompany Doesn't

| Capability | ohmyappbuilder | happycompany |
|------------|----------------|-----------------|
| Wish capture (natural language to structured intent) | Full pipeline: wish.md parser + ADK reasoner (LLM-based intent extraction) | None. App creation is manual (code + README + CLAUDE.md) |
| Intent review + approval | Human-in-the-loop checkpoint system with plan_review and escalation gates | None. No approval workflow |
| Agentic build orchestration | Explorer -> Planner -> Executor -> Reviewer chain, each a Claude SDK subagent | None. No agent orchestration |
| Code generation (models, services, CLI, importers, tests) | Full generator suite: Scaffolder + ModelGen + ServiceGen + CLIGen + ImporterGen + TestGen | None. Apps are hand-written |
| Automated testing of generated apps | run_tests step in bridge, pytest against generated code | None |
| Deployer (corp dir layout) | `corp/{enterprise}/{app}/` with skill/ + data/ split | `registry.publish()` stores versioned app dirs in registry.json |
| Skill packaging | SkillPacker generates SKILL.md + prompts/ + tools/ | Apps are installed as skill dirs into workdir's `.claude/skills/` |
| Runtime CLI console + chat | Web UI with quick-action buttons and per-chat Claude Agent sessions | `app-runner.ts` has CLI execution via `bin/run`, but no web console or chat |
| SSE build streaming | Real-time build progress via EventSource | No build pipeline, no streaming |
| LLM profile management | AES-GCM encrypted profile store for multiple Anthropic-compatible endpoints | Single `config.json` with one API key |

### Bottom line

ohmyappbuilder provides the **entire creation side** of the app lifecycle (wish -> intent -> code -> deploy) that happycompany's concept design calls for in its "iteration loop" section but has not implemented. happycompany provides the **runtime/distribution side** (channels, sessions, workdir, registry, install) that ohmyappbuilder lacks.

---

## 2. Pipeline Mapping: ohmyappbuilder wish-to-build -> happycompany publish

```
ohmyappbuilder                         happycompany (concept)
─────────────────                      ─────────────────────────
wish.md (user input)                   N/A (no equivalent)
    │
    v
ADK Reasoner → intent.draft.yaml       N/A
    │
    v
Human review → intent.approved.yaml    N/A (but concept design wants this)
    │
    v
Orchestrator (Explorer/Planner/
  Executor/Reviewer)                    N/A
    │
    v
Bridge: scaffold + generate             N/A (but concept design calls for "AI generates iteration plan")
  models/services/CLI/tests
    │
    v
run_tests (pytest)                      N/A
    │
    v
Deployer → corp/{ent}/{app}/            ← maps to → registry.publish() + workdir install
    │
    v
Runtime CLI console + chat             ← maps to → app-runner.ts + bot session
```

The integration point is clear: ohmyappbuilder's deployer output (`corp/{ent}/{app}/`) is structurally compatible with happycompany's app source directory. The deployer's `skill/` and `data/` subdirs map to what `registry.publish()` tracks.

---

## 3. Concrete Integration Options

### Option A: CLI Subprocess (Recommended)

Run ohmyappbuilder as a subprocess from happycompany's web server.

**How it works:**
- happycompany's "admin dev UI" (not yet built) adds a "New App from Wish" button
- On submit, happycompany shells out: `builder wish submit <session-dir>`
- After intent approval, shell out: `builder build run <session-dir>`
- On build success, read `outcome.yaml` from session dir
- Call `registry.publish()` pointing at `session_dir/workdir/corp/{ent}/{app}/`

**Pros:**
- Zero code coupling between the two projects
- ohmyappbuilder can be developed/updated independently
- happycompany just orchestrates the CLI + reads output files
- Works with ohmyappbuilder's existing SSE streaming (proxy it)

**Cons:**
- Requires Python runtime on the same machine
- Session directory coordination needs agreement
- Two web servers (unless happycompany proxies ohmyappbuilder)

**Integration effort:** ~2-3 days. Mostly glue code in happycompany's web routes + a proxy for SSE.

### Option B: Import as Python Dependency

Add ohmyappbuilder as a Python package dependency and call its APIs directly from a Python microservice.

**How it works:**
- Create a thin Python API wrapper around ohmyappbuilder's builder module
- Expose REST endpoints that happycompany's TypeScript server calls
- Or: run happycompany's admin features in Python too (breaks current TS-only plan)

**Pros:**
- Direct API access, no subprocess overhead
- Can share session state in-memory

**Cons:**
- Breaks happycompany's "TypeScript for platform, Python for app CLI" language strategy (Concept Design decision #14)
- Couples the two codebases' release cycles
- ohmyappbuilder has no package.json/setup.py entry point for library use

**Integration effort:** ~5-7 days. Requires refactoring ohmyappbuilder for library use + building a REST bridge.

### Option C: Copy and Adapt Generator Code

Copy the generator suite (scaffolder, model_gen, service_gen, cli_gen, importer_gen, test_gen) into happycompany, rewriting in TypeScript or calling from a bundled Python helper.

**Pros:**
- Full control, can adapt generators to happycompany's app structure
- No external dependency

**Cons:**
- Massive effort (~800+ lines of Python generator code to port)
- Loses the agentic pipeline (Explorer/Planner/Executor/Reviewer) which is the real value
- Loses the ADK reasoner (intent extraction) which requires Claude SDK
- Divergent codebases to maintain

**Integration effort:** ~2-3 weeks. Not recommended.

### Option D: Hybrid -- CLI for Build, Unified Runtime

Use Option A for the build pipeline but replace ohmyappbuilder's runtime (web UI, CLI console, chat) with happycompany's bot session model.

**How it works:**
- Build pipeline: happycompany calls `builder` CLI (Option A)
- After deploy, instead of ohmyappbuilder's runtime web UI, the generated CLI is installed into workdir's `.claude/skills/` via `registry.installApp()`
- Users interact via happycompany's existing channel adapters (Feishu, DingTalk)
- Bot sessions naturally route to the installed CLI skill

**Pros:**
- Each project does what it's best at
- ohmyappbuilder handles creation, happycompany handles distribution and usage
- Clean separation of concerns
- Runtime chat (ohmyappbuilder's Layer 3) is redundant with happycompany's bot session

**Cons:**
- Same subprocess coordination as Option A
- ohmyappbuilder's runtime web UI (quick-action buttons, streaming) would need equivalent in happycompany's channel cards

**Integration effort:** ~3-5 days. Best ROI.

---

## 4. What Would Need to Change in happycompany

| Change | Scope | Priority |
|--------|-------|----------|
| Add "admin build" routes to web server | New module: `src/admin-build.ts` | P0 |
| Proxy SSE from ohmyappbuilder build server | Modify `src/web.ts` | P0 |
| Parse `outcome.yaml` after build completes | New utility: ~30 lines | P0 |
| Call `registry.publish()` with build output | Wire into admin routes: ~20 lines | P0 |
| Add `wish.md` submission form to admin UI | Frontend (if/when web UI exists) | P1 |
| Add intent/approval review UI | Frontend | P1 |
| Map ohmyappbuilder's `corp/` layout to registry dir convention | Config convention | P0 |
| Add Python runtime check at startup | `src/config.ts`: ~10 lines | P1 |
| LLM profile management (multi-endpoint) | Extend `config.json` schema | P2 |

### Data convention

ohmyappbuilder outputs to `corp/{enterprise}/{app}/`:
```
corp/acme/tracker/
├── skill/           # SKILL.md + prompts/
├── data/            # full app: pyproject.toml, tracker/, tests/
└── (app_name).db
```

happycompany's registry stores `dir` as an absolute path in `registry.json`. Mapping:
- `registry.publish(dataDir, name, version, dir)` where `dir` = `<session-dir>/workdir/corp/acme/tracker/data/`
- Skill files at `<session-dir>/workdir/corp/acme/tracker/skill/` get installed to workdir's `.claude/skills/`

---

## 5. Recommended Approach

**Option D (Hybrid) with Option A as the integration mechanism.**

### Phase 1: Minimal Build Integration (2-3 days)

1. Add a `src/admin-build.ts` module with three functions:
   - `startBuild(sessionDir: string): Promise<string>` -- shells `builder build run`
   - `parseOutcome(sessionDir: string): BuildOutcome` -- reads `outcome.yaml`
   - `publishBuild(dataDir: string, outcome: BuildOutcome): AppInfo` -- calls `registry.publish()`

2. Add SSE proxy to web server:
   - Admin triggers build -> happycompany starts ohmyappbuilder's build server as subprocess
   - Proxy EventSource stream to admin frontend

3. After build completes, read `outcome.yaml`, call `registry.publish()`, then `installApp()` to target workdir.

### Phase 2: Wish + Intent Integration (3-5 days)

4. Add wish submission endpoint that creates a session dir and calls `builder wish submit`
5. Add intent review endpoint that serves `intent.draft.yaml` and accepts approve/reject
6. Streamline: approve -> `builder build run` -> publish -> install

### Phase 3: Remove Redundancy (2-3 days)

7. Deprecate ohmyappbuilder's runtime web UI (Layer 3)
8. All user interaction goes through happycompany's channels (Feishu/DingTalk bot sessions)
9. ohmyappbuilder becomes a pure build pipeline service

---

## 6. Key Files Reference

### ohmyappbuilder (Python)

| File | Role |
|------|------|
| `src/builder/wish/parser.py` | wish.md -> WishDoc |
| `src/builder/adk/reasoner.py` | WishDoc -> IntentDraft (LLM) |
| `src/builder/adk/models.py` | IntentDraft Pydantic model |
| `src/builder/agentic/orchestrator.py` | Explorer -> Planner -> Executor -> Reviewer chain |
| `src/builder/agentic/bridge.py` | plan.yaml -> generator invocations (the glue) |
| `src/builder/scaffolder.py` | Project skeleton generator |
| `src/builder/generator/model_generator.py` | DomainModelSpec -> SQLAlchemy ORM files |
| `src/builder/generator/service_generator.py` | Service layer code gen |
| `src/builder/generator/cli_generator.py` | Click CLI code gen |
| `src/builder/generator/importer_generator.py` | CSV importer code gen |
| `src/builder/generator/test_generator.py` | pytest code gen |
| `src/builder/generator/skill_packer.py` | App -> Claude Skill packaging |
| `src/builder/generator/app_generator.py` | Orchestrates all generators + constraint checking |
| `src/builder/deployer.py` | Generated app -> corp/ layout |

### happycompany (TypeScript)

| File | Role |
|------|------|
| `src/registry.ts` | App version registry (publish, install, rollback) |
| `src/workdir.ts` | Workdir management (install/remove apps) |
| `src/app-runner.ts` | CLI execution in workdir context |
| `src/web.ts` | Fastify web server |
| `src/web-app-routes.ts` | Web app routes |
| `src/agent.ts` | Claude Agent SDK session |
| `src/skills.ts` | Skill management utilities |
| `src/config.ts` | Configuration (API keys, etc.) |
