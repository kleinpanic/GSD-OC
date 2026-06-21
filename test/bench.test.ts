import { test } from "node:test";
import assert from "node:assert/strict";
import { tokensAB, completionRate, skillScore, falseAllows, tokenRot, overOrchestrated } from "../src/bench/metrics.js";
import { scoreBehavior } from "../src/bench/rubric.js";
import type { TaskTrace } from "../src/bench/types.js";

function trace(p: Partial<TaskTrace>): TaskTrace {
  return { taskId: "t", band: "complex", gsdOn: true, toolSequence: [], firedSubagents: [], backboneVerbs: [], blockedEdits: [], falseAllows: 0, totalTokens: 0, wallClockMs: 0, reachedDone: true, ...p };
}

test("M1 tokensAB: GSD-on vs GSD-off delta per band", () => {
  const ab = tokensAB([
    trace({ band: "trivial", gsdOn: true, totalTokens: 800 }),
    trace({ band: "trivial", gsdOn: false, totalTokens: 1000 }),
  ]);
  assert.equal(ab.trivial.on, 800);
  assert.equal(ab.trivial.off, 1000);
  assert.ok(Math.abs(ab.trivial.deltaPct! - 0.2) < 1e-9, "20% fewer tokens on the trivial band");
});

test("M2/M3/M4: completion, skill recall, enforcement", () => {
  assert.equal(completionRate([trace({ reachedDone: true }), trace({ reachedDone: false })]), 0.5);
  assert.deepEqual(skillScore(trace({ firedSubagents: ["gsd-planner", "gsd-executor"] }), ["gsd-planner", "gsd-executor", "gsd-verifier"]), { recall: 2 / 3, precision: 1 });
  assert.equal(falseAllows([trace({ falseAllows: 0 }), trace({ falseAllows: 2 })]), 2);
});

test("M6 tokenRot: redundant reads + loop depth", () => {
  const r = tokenRot(trace({ toolSequence: [
    { name: "read", input: { file_path: "a.ts" }, seq: 1 },
    { name: "read", input: { file_path: "a.ts" }, seq: 2 },
    { name: "gsd_retrieve", input: { intent: "x" }, seq: 3 },
    { name: "gsd_retrieve", input: { intent: "x" }, seq: 4 },
  ] }));
  assert.equal(r.redundantReads, 1);
  assert.equal(r.loopDepth, 1, "the two identical retrieves are a run of 1 repeat");
});

test("M7 over-orchestration: trivial task that fanned out", () => {
  assert.ok(overOrchestrated(trace({ band: "trivial", firedSubagents: ["gsd-executor"] })));
  assert.ok(!overOrchestrated(trace({ band: "trivial", firedSubagents: [] })));
  assert.ok(!overOrchestrated(trace({ band: "complex", firedSubagents: ["gsd-executor"] })));
});

test("rubric: a clean complex run scores high; a false-allow fails 0-tolerance", () => {
  const good = scoreBehavior(trace({
    toolSequence: [{ name: "gsd_orchestrate", seq: 1 }],
    firedSubagents: ["gsd-planner", "gsd-executor", "gsd-verifier"],
    backboneVerbs: ["plan", "execute", "verify"], reachedDone: true,
  }), ["gsd-planner", "gsd-executor", "gsd-verifier"]);
  assert.ok(good.score >= 0.9 && !good.failed, JSON.stringify(good));
  const bad = scoreBehavior(trace({ falseAllows: 1 }), []);
  assert.ok(bad.failed, "a false-allow is a hard fail");
});
