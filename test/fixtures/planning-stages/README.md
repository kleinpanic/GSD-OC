# planning-stages fixtures

Staged `.planning/` trees consumed by the loop-ordering test (`test/loop-order.test.ts`,
Plan 04-03) to prove ORCH-05 lifecycle ordering: `route()` → `decideDispatch` advances
research/plan → execute → verify as artifacts accumulate.

The ordering test builds these trees in a temp dir at runtime (mirroring the
`engine-state.test.ts` `mkdtempSync` pattern), so this directory holds only this
documentation note — there are no committed fixture trees here.

## Stages built by the ordering test (Plan 04-03)

| Stage | `.planning/` contents | expected route action | decideDispatch mode |
|-------|----------------------|-----------------------|---------------------|
| context-present | ROADMAP + phase dir with `*-CONTEXT.md`, no plans | `plan-phase` | code-driven |
| plans-no-summaries | + `*-PLAN.md` files, no summaries | `execute-phase` | code-driven |
| all-summaries-last-phase | + matching `*-SUMMARY.md`, single/last phase | `verify-work` | agent-driven (gate) |

> Stub note (Plan 04-01): this file is created by Plan 04-01 and fleshed out by Plan 04-03
> when the ordering test lands.
