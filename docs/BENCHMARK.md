# Benchmark — measurable, log-grounded

GSD-OC ships two measurement layers:

| Layer | Command | Answers |
|---|---|---|
| **Health** (parity) | `npm run health` | *Does it work?* — 6-pillar PASS/FAIL parity scorecard |
| **Bench** (quantitative) | `npm run bench` | *Does it help, and by how much?* — token + behavior metrics from **real** runs |

The bench reads actual OpenClaw gateway runs from `~/.openclaw/lcm.db` (read-only) and scores what the agent
**actually did** — not a synthetic replay. `src/bench/log-parse.ts` normalizes each gsd session into a
`TaskTrace`; `metrics.ts` + `rubric.ts` are pure functions over it (unit-tested in `test/bench.test.ts` +
`test/log-parse.test.ts`, so they run in CI with no db).

## Metrics (each has a method)

| # | Metric | Method |
|---|---|---|
| M1 | **Tokens-per-task A/B** | sum `step_tokens_in+out` over the session tree, GSD-on vs GSD-off, per band; `deltaPct` |
| M2 | Lifecycle-completion rate | % of complex tasks reaching a terminal GSD state |
| M3 | Skill recall / precision | fired `subtask_agent` set vs the expected-subagent label |
| M4 | **Enforcement false-allows** | mutating edit allowed while *not* planned — **hard 0-tolerance** |
| M6 | **Token-rot** | redundant file re-reads + retrieve repeats + max same-tool **loop depth** |
| M7 | **Over-orchestration** | a *trivial* task that spawned subagents / ran >1 backbone stage |

## Behavior rubric (`scoreBehavior`)

Six deterministic dimensions → a 0..1 score (no LLM judge in the score, so it's reproducible):
`engaged` (0.2), `rightPath` (0.25), `ordered` (0.15), `enforced` (0.15), `notRotted` (0.15), `notOverDone` (0.1).
`enforced < 1` is a **0-tolerance fail** regardless of the weighted total.

## Running
```bash
npm run bench          # live behavior audit over ~/.openclaw/lcm.db (table)
npm run bench -- --json # machine-readable
```
With no db (CI), it prints the metric definitions and exits 0. The A/B arm (GSD-on vs GSD-off over a fixed task
set) and the committed-baseline regression gate are the next layer on this foundation — the parser, metrics, and
rubric they need are already built + tested.
