# GSD-OC — GSD for OpenClaw

**Get-Shit-Done lifecycle orchestration as a native OpenClaw plugin.**
Turns a coding/big-work prompt into a driven, *enforced* GSD lifecycle — research → map → plan →
execute → code-review → verify → ship — for **any** OpenClaw agent, **without typing a single `/command`**.

![tests](https://img.shields.io/badge/tests-456%20passing-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D22-blue)
![license](https://img.shields.io/badge/license-MIT-blue)
![discord slots](https://img.shields.io/badge/discord%20slash%20slots-0-success)

GSD-OC is its own thing: **no Claude Code runtime dependency, no `@opengsd/*` runtime dependency,
no ACP-into-Claude.** The GSD state engine is reimplemented natively in TypeScript, the GSD doc
corpus is snapshotted and bundled at build time, and the whole surface goes through tool-search +
routers so it consumes **zero** of Discord's 100 global slash-command slots.

---

## Why it's different

Most "methodology" plugins inject advisory text an agent can ignore. GSD-OC **enforces** the lifecycle
deterministically through OpenClaw's `before_tool_call` hook — a host-honored block, not a suggestion.

| Pillar | What it does |
|---|---|
| **Retrieval** | Hybrid search (spark embeddings + LanceDB + BM25 + trigram, fused via RRF) maps a free-text intent to the right GSD skills/subagents — long-tail aware (`"the build is flaky"` → `gsd-debugger`). Degrades gracefully to lexical when embeddings are offline. |
| **Enforcement** | `before_tool_call` **blocks file edits** until the current phase is planned, and **injects the matching GSD persona** into every subagent spawn — so no agent edits code out of order or spawns a bare, instruction-less subagent. |
| **State engine** | A native TS reimplementation of `gsd-tools`: `route()` reads `STATE.md` + phase artifacts to decide the next action; `gsd_state` advances it atomically under a lockfile. The read half and the write half are both live. |

## How it works

```
coding intent
   │  auto-engage (before_prompt_build) injects GSD policy
   ▼
gsd_orchestrate ── retrieves relevant skills (gsd_retrieve) ──► selects a finite path
   │                                                            discuss → map-codebase → research →
   │                                                            plan → execute → code-review → verify → ship
   │                                                            (+ conditional: debug / secure / ui / ai / spike …)
   ▼
per step: dispatch the matching gsd-* subagent (persona injected, model-tier routed)
   │
before_tool_call gate: edits blocked until planned · personas injected on spawns · FAILED verification halts
```

A prompt like *"add OAuth login"* auto-engages, retrieves the relevant skills, emits a path that
**includes the `secure` threat-model stage**, and gates code edits until the phase is planned.

## Quick start

```bash
npm install
npm run build                 # tsc → dist/ (ESM) + bundles corpus/vectors for self-contained runtime
npm test                      # 456 tests (node:test)
npx openclaw plugins build    # generates openclaw.plugin.json
npx openclaw plugins validate # → "Plugin gsd-oc is valid."
```

Semantic retrieval needs a spark NIM embeddings endpoint via env (`SPARK_HOST` +
`SPARK_BEARER_TOKEN`/`SPARK_API_KEY`, never inlined); without it, retrieval degrades to BM25 + trigram.
See [docs/USAGE.md](docs/USAGE.md) for install, configuration, and a worked end-to-end example.

## The 15 tools (0 Discord slash slots)

| Tool | Purpose |
|---|---|
| `gsd_orchestrate` | Route a coding intent through the GSD lifecycle; `drive:true` dispatches the path; **`autonomous:true`** drives the full multi-phase loop to milestone completion. |
| `gsd_retrieve` | Hybrid retrieval of the relevant GSD skills/subagents for a free-text intent. |
| `gsd_command` | Invoke **any** individual GSD command/skill by name (roadmapper, executor, planner, researchers, code-review, debug…) with **intent-inferred flags**. |
| `gsd_state` | The **write engine**: `init` (scaffold a validated `.planning/`), status/progress/decisions/blockers, phase CRUD, plan-progress, complete-phase/requirement/milestone — atomic. |
| `gsd_verify` | The **integrity engine**: validate-artifacts gate, phase-completeness, consistency, gap-checker, uat, audit-open, health. |
| `gsd_workstream` | Parallel GSD tracks (`.planning/workstreams/<name>/`) — list/create/switch/complete + **dynamic intent-based adoption**. |
| `gsd_session` | pause/resume (writes the checkpoint route() halts on) + thread + capture. |
| `gsd_learnings` | Cross-project knowledge store (decisions/lessons/patterns). |
| `gsd_settings` | Inspect / bootstrap the project's GSD config. |
| `gsd_workflow` · `gsd_project` · `gsd_quality` · `gsd_context` · `gsd_manage` · `gsd_ideate` | 6 namespace routers — state-aware next-verb routing. |

`registerCommand` is **0** (asserted by a slot-audit test) — the entire surface is tool-search-reachable. The
orchestrator can now **write what it routes** (phase/roadmap/milestone/requirement CRUD) and **verify it** (the
integrity engine), and drive the **autonomous multi-phase loop** with a no-progress guard.

## Operator configuration

Auto-engage uses the `before_prompt_build` hook, which OpenClaw gates for non-bundled plugins. The
**operator** enables it in `~/.openclaw/openclaw.json` (the plugin never writes host config — it only
reads it via the SDK):

```jsonc
{ "plugins": { "entries": { "gsd-oc": { "hooks": { "allowPromptInjection": true } } } } }
```

Per-project opt-out: a `.gsd-off` file, `pluginConfig`, or `workflow.enforce_tool_gate: false` in
`.planning/config.json`. See [docs/USAGE.md](docs/USAGE.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, the three pillars, lifecycle flow
- [docs/CONFIG.md](docs/CONFIG.md) — the two config layers + full GSD config-key parity (workflow/git/review/research providers…)
- [docs/FLAGS.md](docs/FLAGS.md) — flags as a layer of intent (`--all`/`--tdd`/`--wave N`/…)
- [docs/RETRIEVAL.md](docs/RETRIEVAL.md) — the hybrid retrieval engine (corpus, modalities, RRF, incremental re-index)
- [docs/ENFORCEMENT.md](docs/ENFORCEMENT.md) — the `before_tool_call` gate + spawn-persona model
- [docs/SUBAGENTS.md](docs/SUBAGENTS.md) — the 33 ported GSD subagents + model routing
- [docs/USAGE.md](docs/USAGE.md) — install, configure, use
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) · [CONTRIBUTING.md](CONTRIBUTING.md) — build pipeline, testing, contributing

## Project status

Milestone **M1 (Retrieval Core)** complete, with the finite-path orchestrator + enforcement layer built.
Hardened through **9 rounds of adversarial multi-agent code review** to convergence — the full
round-by-round log (CRITICAL → HIGH → converged, ~37 bugs fixed) is in
[docs/REVIEW-LOG.md](docs/REVIEW-LOG.md). The plugin was itself built with the GSD methodology it ports.

## Constraints (by design)

- OpenClaw plugin SDK — `definePluginEntry` (hooks + service + dynamic tools + runtime). Node ≥ 22,
  TypeScript ESM, `typebox` runtime dep, `openclaw ≥ 2026.5.17`.
- No Claude Code in the loop; native OpenClaw orchestration.
- No `@opengsd/*` at runtime — the state engine is reimplemented in native TS.
- Discord's 100-slash-command cap respected — the GSD surface goes through tool-search + routers.
- Never mutates the host OpenClaw config or storage; no secrets inlined.

## License

[MIT](LICENSE) © Klein Panic
