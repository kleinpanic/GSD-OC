# GSD-OC vs Upstream GSD — Critical Parity Audit (2026-06-20)

Three opus reviewers cloned/compared upstream `gsd-core` (~/.claude v1.4.5 + GitHub open-gsd/gsd-core)
against the port. **The port is a strong READ + ROUTE + RETRIEVE + PLAN layer, but is missing the
WRITE + ENFORCE + EXECUTE half that makes GSD actually GSD.** Honest, evidence-backed.

## CRITICAL gaps (the port "doesn't do GSD's job" without these)

1. **State mutation is dead code (ENG-WRITE).** `state.ts` `writeStateMd`/`readModifyWriteStateMd`/`withStateLock`
   exist with **zero callers**. Nothing writes STATE.md / ROADMAP.md / REQUIREMENTS.md. The core GSD loop
   (begin-phase → advance-plan → complete-phase → milestone-switch → add-decision/blocker/metric) does NOT
   exist. STATE.md goes stale the moment work runs, and `route()` then routes off stale data. ~5 of ~100
   `gsd-tools` verbs are implemented; **every mutation verb is absent.**

2. **No enforcement (ENF-HOOK).** The lifecycle is advisory prose injected into AGENTS.md + an opt-in tool.
   There is NO `before_tool_call` gate blocking Edit/Write until `route()` permits. Upstream `exit 1`s; we
   inject a paragraph. An agent can ignore all of it and freestyle. **OpenClaw DOES support `before_tool_call`
   with a block result** (verified) — so this is buildable, not a platform limit.

3. **Retrievable ≠ executable (EXEC).** 88 workflows / 69 skills are corpus docs + a path selector + a route
   verb. Nothing EXECUTES a workflow; the orchestrator hands the agent a path of strings.

## HIGH gaps
4. **Roadmap/requirements/phase/verify mutation absent** — `requirements.mark-complete`, `roadmap.*`,
   `milestone.complete`, phase CRUD, the 8 `verify.*` + 4 `validate.*` integrity verbs — all missing.
5. **18 nested sub-workflows dropped from the corpus** — incl. the execute-phase SAFETY gates
   (`codebase-drift-gate`, `per-plan-worktree-gate`, `post-merge-gate`) + discuss-phase modes + help modes.
   "88 workflows" is top-level only; the corpus indexer dropped the nested mode/step/template layer.
6. **Config schema incomplete** — `defaultGsdConfig()` ~40 keys vs upstream's 107 `VALID_CONFIG_KEYS`; whole
   sections missing (effort.*, fast_mode.*, planning.*, graphify.*, plan_review.*, context_window, …); no
   `config-set` mutation surface. (Two wrong defaults auto_advance/plan_bounce → FIXED 8a74690.)
7. **Dangling MCP refs** — 10 `mcp__context7__*` citations remain in personas but the tool was dropped from
   every allowlist (no exec/web fallback rewrite). Agents told to use a tool they can't call.
8. **Backlog-deferral route (999.x) missing** — the one route step that mutates state can't run.

## FIXED this session (parity-review-driven)
- PORT-01 transform regression: corrupted a bash shim + left 21 bare-`.claude/` refs → repaired (d9685ae).
- Model routing was dead code (resolveModel 0 callers) → wired live into runSubagent (8a74690).
- Config defaults auto_advance/plan_bounce true→false (8a74690).

## Honest bottom line
As shipped, an OpenClaw agent with this plugin will: auto-engage (advisory), retrieve the right skills,
and emit the right path — then **freestyle**, because nothing enforces the gates and nothing records that
work happened. The route engine is faithful but operates on state the port never writes.
