# GSD-OC — GSD for OpenClaw

## What This Is

An OpenClaw **internal plugin + toolset** that brings the GSD methodology (research →
codebase-map → plan → execute → verify → ship) natively into OpenClaw for **any**
OpenClaw agent. It auto-engages on coding/big work (especially under `~/codeWS`),
drives the ported GSD subagents in the correct order **without the user typing a single
`/command`**, and runs decision gates as Discord-native interactions. It is its own
thing — distinct from Claude Code and from opengsd — with no Claude Code runtime
dependency and no ACP-into-Claude as the target.

## Core Value

A coding/big-work prompt auto-engages GSD and drives the full lifecycle to completion
**without any GSD `/command`**, proven in a real OpenClaw gateway session — natively,
no Claude Code in the loop.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **R0.1** — No Claude Code dependency or ACP-into-Claude as target; GSD loop runs natively for any OpenClaw agent
- [ ] **R0.2** — Every CC-ism reimplemented as OpenClaw-canonical (tools / subagents / hooks / config + Discord-native gates)
- [ ] **R0.3** — opengsd is reference only; no opengsd package vendored/required at runtime (state engine reimplemented native)
- [ ] **R0.4** — Namespace-router + toolSearch design so the full GSD surface is reachable by intent without exceeding Discord's 100 global slash-command cap
- [ ] **R0.5** — Auto-engage for coding work in `~/codeWS` (and elsewhere), with explicit opt-out
- [ ] **R1** — Delivered as an OpenClaw plugin exposing a GSD toolset (its own package.json + git repo)
- [ ] **R2** — Full GSD loop runs without per-step slash commands
- [ ] **R3** — Intent classifier decides when GSD auto-applies; explicit opt-out/override
- [ ] **R4** — Full lifecycle with on-disk `.planning/` artifacts (PROJECT/ROADMAP/CONTEXT/PLAN/STATE/SUMMARY/VERIFICATION)
- [ ] **R5** — All 33 GSD subagents ported to OpenClaw agent configs, each keeping role + tool allowlist
- [ ] **R6** — cwd-aware; `.planning/` lives in target project dir; works under `~/codeWS` and elsewhere
- [ ] **R7** — Discord-native interactive gates (buttons / select menus / modals / polls) — full equivalent, not degraded text
- [ ] **R8** — Its own workstream: own `.planning/`, git repo, tests, release cycle

### Out of Scope

- ACP-into-Claude as the production execution path — violates R0.1; permitted only as a throwaway spike
- The `.openclaw` host config / dynamic-injection tuning — separate `.openclaw` Phase 29 workstream
- The `openclaw-governance` plugin — its own workstream
- Mutating `/srv/storage` or host `~/.openclaw/openclaw.json` from this repo — hard constraint
- Remote *execution* (paired-node/ACP run) — designed-for now, implemented in a later milestone (OD6)

## Context

- **Research is complete** and primary-sourced: `.planning/research/GSD-PORT-ARCHITECTURE.md`
  (GSD internals + port options A/B/C) and `.planning/research/DEEP-DOCS-RESEARCH.md`
  (OpenClaw plugin SDK via firecrawl/context7; supersedes the prior "honest ceiling" —
  plugin-driven code orchestration IS viable). Full requirements brief at
  `.planning/REQUIREMENTS-AND-SPEC.md`.
- **GSD reference substrate** retained: `.planning/research/gsd-source/` (May-5 v1.39 mirror,
  incl. the dropped headless SDK) + `REPOSITORY-STRUCTURE.md` (file-map; its agent table is
  stale — trust the live `~/.claude/agents/gsd-*.md` roster instead).
- **Live GSD install** at `~/.claude/gsd-core/` (v1.4.5) + `~/.claude/agents/gsd-*.md` (33 agents)
  is the porting spec: `gsd-tools.cjs` (83KB pure-CJS state engine, zero model calls, MIT) and
  the `workflows/*.md` (foreground orchestration prose).
- **Empirical fact** driving the architecture: GSD is a **foreground orchestrator** (all routing
  in `next.md`, all `discuss-phase` conversation, all gates run in the foreground agent) that
  delegates only specific heavy/parallel steps (research, plan, execute, verify) to subagents.
- **OpenClaw primitives** (from deep research): `api.runtime.subagent.run`/`waitForRun` (code-driven
  spawn), `sessions_spawn`/`sessions_yield` (agent-driven spawn), `before_prompt_build` /
  `agent_turn_prepare` (auto-engage injection), `before_agent_finalize` + `enqueueNextTurnInjection`
  (cross-turn auto-advance), `tools.toolSearch` + router tools (Discord cap solution),
  `api.runtime.system.runCommandWithTimeout` (shell), `managedFlows`/session-extensions (durable state).

## Constraints

- **Tech stack**: OpenClaw plugin SDK — `definePluginEntry` (needs hooks + service + dynamic tools
  + runtime). Node >= 22, TypeScript ESM, `typebox` runtime dep, `openclaw >= 2026.5.17`.
- **No Claude Code**: native OpenClaw orchestration; ACP-into-Claude only as a throwaway spike (R0.1).
- **No opengsd at runtime**: state engine reimplemented in native TS (R0.3); `gsd-tools.cjs` read as spec only.
- **Discord cap**: 100 global slash commands — GSD surface MUST go through toolSearch + routers (R0.4).
- **Hard no-touch**: never mutate `/srv/storage` or host `~/.openclaw/openclaw.json`; no secrets inlined;
  never `--no-verify`; never force-push.
- **Git identity** is locked (Klein Panic / GPG-signed) — do not modify git config.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Reset GSD-OC to a fresh GSD project | Prior skeleton (PHASE1-CHECKLIST/sorted/unsorted/v2 PROJECT.md) targeted a phantom `@gsd-build/sdk` v2.75.0; research said DISCARD | — Pending |
| OD1: Per-step dispatch mix | Foreground OpenClaw agent is the orchestrator (required for conversation/gates); subagent steps dispatched agent-driven for gate phases, code-driven for parallel fan-outs; auto-advance via `before_agent_finalize`+`enqueueNextTurnInjection` | — Pending |
| OD2: Full native TS port of the state engine | R0.3 forbids vendoring opengsd at runtime; MIT license permits reading `gsd-tools.cjs` as spec; user chose full parity over scoped subset | — Pending |
| OD3: Multi-mechanism opt-out + codeWS auto-invoke | `.gsd-off` marker + session toggle + config flag; auto-engage gated on workspace path + big-work intent | — Pending |
| OD4: Port all 33 subagents | Full roster as OpenClaw `agents.list[]` configs, each keeping role + tool allowlist | — Pending |
| OD5: All Discord gate primitives | Buttons (binary/small-N), select menus (large sets), modals (free text), native polls (ranked/multi-pick) | — Pending |
| OD6: cwd-aware local now, design-for-remote | Build fully cwd-aware; document remote path (`api.runtime.nodes`/ACP); defer remote execution | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-18 after initialization*
