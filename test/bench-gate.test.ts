import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSnapshot, compareToBaseline, type Baseline } from "../src/bench/gate.js";
import { BENCH_TASKS } from "../src/bench/tasks.js";
import type { TaskTrace } from "../src/bench/types.js";

function trace(p: Partial<TaskTrace>): TaskTrace {
  return { taskId: "t", band: "complex", gsdOn: true, toolSequence: [], firedSubagents: [], backboneVerbs: [], blockedEdits: [], falseAllows: 0, totalTokens: 0, wallClockMs: 0, reachedDone: true, ...p };
}

test("BENCH_TASKS: 14 tasks across 7 bands, expectations reference real roster agents", async () => {
  assert.equal(BENCH_TASKS.length, 14);
  assert.equal(new Set(BENCH_TASKS.map((t) => t.band)).size, 7);
  const { resolveAgentOptional } = await import("../src/agents/index.js");
  for (const t of BENCH_TASKS) for (const a of t.expectSubagents) assert.ok(resolveAgentOptional(a), `${t.id} expects unknown agent ${a}`);
});

test("computeSnapshot: derives the metric set from labeled A/B traces", () => {
  const traces = [
    trace({ taskId: "c-ratelimit", band: "complex", gsdOn: true, firedSubagents: ["gsd-planner", "gsd-executor", "gsd-verifier"], backboneVerbs: ["plan", "execute", "verify"], toolSequence: [{ name: "gsd_orchestrate", seq: 1 }], reachedDone: true }),
    trace({ taskId: "t-typo", band: "trivial", gsdOn: true, totalTokens: 800, reachedDone: true }),
    trace({ taskId: "t-typo", band: "trivial", gsdOn: false, totalTokens: 1000, reachedDone: true }),
  ];
  const snap = computeSnapshot(traces, BENCH_TASKS);
  assert.ok(Math.abs((snap["tokens.trivial.deltaPct"] ?? 0) - 0.2) < 1e-9);
  assert.equal(snap["enforce.falseAllows"], 0);
  assert.ok((snap["behavior.score.mean"] ?? 0) > 0);
});

test("compareToBaseline: passes a healthy snapshot, FAILS on a false-allow regression", () => {
  const baseline: Baseline = { metrics: { "enforce.falseAllows": { value: 0, bar: "==", eq: 0 }, "behavior.score.mean": { value: 0.85, bar: "≥", min: 0.8, tol: 0.03 } } };
  const good = compareToBaseline({ "enforce.falseAllows": 0, "behavior.score.mean": 0.9 } as never, baseline);
  assert.ok(good.pass, JSON.stringify(good.regressions));
  const bad = compareToBaseline({ "enforce.falseAllows": 1, "behavior.score.mean": 0.9 } as never, baseline);
  assert.ok(!bad.pass);
  assert.equal(bad.regressions[0].metric, "enforce.falseAllows");
  const lowBehavior = compareToBaseline({ "enforce.falseAllows": 0, "behavior.score.mean": 0.5 } as never, baseline);
  assert.ok(!lowBehavior.pass, "behavior below min-tol regresses");
});
