# planning-stages fixtures

Staged `.planning/` trees consumed by the loop-ordering test (`test/loop-order.test.ts`,
Plan 04-03) to prove ORCH-05 lifecycle ordering: `route()` → `decideDispatch` advances
research/plan → execute → verify as artifacts accumulate.

The ordering test builds these trees in a temp dir at runtime (mirroring the
`engine-state.test.ts` `mkdtempSync` pattern), so this directory holds only this
documentation note — there are no committed fixture trees here.

## Stages built by the ordering test (`test/loop-order.test.ts`)

The test creates a single-phase `.planning/` tree in a temp dir and mutates it forward,
calling `route()` → `decideDispatch()` at each stage:

| Stage | `.planning/` contents added | `route().action` | `decideDispatch().mode` | agentId |
|-------|-----------------------------|------------------|-------------------------|---------|
| 0 no-context | `ROADMAP.md`, `STATE.md`, empty `phases/01-foundation/` | `discuss-phase` | agent-driven (gate) | gsd-planner |
| 1 context | + `1-CONTEXT.md` | `plan-phase` | code-driven | gsd-project-researcher |
| 2 plans | + `01-01-PLAN.md` | `execute-phase` | code-driven | gsd-executor |
| 3 summaries | + `01-01-SUMMARY.md` (last phase) | `verify-work` | agent-driven (gate) | gsd-verifier |

The combined ordering invariant asserted is `[plan-phase, execute-phase, verify-work]`
(stages 1→3), proving ORCH-05 advances research/plan → execute → verify as artifacts
accumulate. The verify-work gate's instruction is asserted to contain `sessions_spawn`
(ORCH-02). Live dispatch against a real gateway is operator-gated → Phase 7 (TEST-02).

## Fixture file formats

`ROADMAP.md` uses `### Phase N: Name` headings (parsed by `parseRoadmapPhases`).
`STATE.md` carries a frontmatter `status:` field. Phase artifacts are matched by
suffix: `*-CONTEXT.md` / `*-RESEARCH.md` (context), `*-PLAN.md` (plans),
`*-SUMMARY.md` (summaries) — see `src/engine/route.ts` and `src/engine/phase.ts`.
