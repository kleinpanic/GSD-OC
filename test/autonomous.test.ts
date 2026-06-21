import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAutonomous } from "../src/orchestrate/autonomous.js";
import type { RouteResult } from "../src/engine/route.js";

function tmpP(): string {
  const d = mkdtempSync(join(tmpdir(), "gsd-au-"));
  const p = join(d, ".planning"); mkdirSync(join(p, "phases", "01-x"), { recursive: true });
  writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: X\n**Goal:** g\n");
  writeFileSync(join(p, "STATE.md"), "---\nstatus: executing\n---\n# State\n");
  return p;
}

// a dispatcher that ADVANCES state by writing the artifact each route action produces
function advancingDispatch(p: string) {
  const pd = join(p, "phases", "01-x");
  return async (r: RouteResult) => {
    switch (r.action) {
      case "discuss-phase": writeFileSync(join(pd, "01-CONTEXT.md"), "# context\n"); break;
      case "plan-phase": writeFileSync(join(pd, "01-01-PLAN.md"), "# plan\n"); break;
      case "execute-phase": writeFileSync(join(pd, "01-01-SUMMARY.md"), "# summary\n"); break;
      case "verify-work": writeFileSync(join(pd, "1-VERIFICATION.md"), "**Status:** PASSED\n"); break;
      default: break;
    }
    return { ok: true };
  };
}

test("runAutonomous drives a phase to milestone completion (multi-phase loop)", async () => {
  const p = tmpP();
  try {
    const r = await runAutonomous(p, advancingDispatch(p), { autoGates: true, maxSteps: 20 });
    assert.ok(r.completed, JSON.stringify(r));
    assert.equal(r.reason, "complete-milestone");
    // it walked the lifecycle actions in order
    const actions = r.steps.map((s) => s.action);
    assert.ok(actions.includes("execute-phase") && actions.includes("verify-work"), JSON.stringify(actions));
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("runAutonomous BAILS on no-progress (dispatch that never advances) — no infinite loop", async () => {
  const p = tmpP();
  try {
    const r = await runAutonomous(p, async () => ({ ok: true }), { autoGates: true, maxSteps: 20 });
    assert.ok(!r.completed);
    assert.equal(r.reason, "no-progress");
    assert.ok(r.steps.length <= 3, "bailed fast, not max-steps");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("runAutonomous halts at a gate when autoGates:false", async () => {
  const p = tmpP();
  try {
    const r = await runAutonomous(p, advancingDispatch(p), { autoGates: false });
    assert.ok(!r.completed);
    assert.equal(r.reason, "gate");
    assert.equal(r.haltedAt, "discuss-phase");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("runAutonomous reports failure when a dispatch fails", async () => {
  const p = tmpP();
  try {
    const r = await runAutonomous(p, async () => ({ ok: false, output: "boom" }), { autoGates: true });
    assert.equal(r.reason, "failure");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("makeActionDispatcher applies manager.flags per action (/gsd-manager parity)", async () => {
  const { makeActionDispatcher } = await import("../src/orchestrate/autonomous.js");
  const seen: string[] = [];
  const run = async (_agent: string, msg: string) => { seen.push(msg); return { ok: true }; };
  const dispatch = makeActionDispatcher(run, "build a thing", { execute: "--tdd", plan: "--mvp" });
  await dispatch({ action: "execute-phase", phase: "1", reason: "" } as never);
  await dispatch({ action: "plan-phase", phase: "1", reason: "" } as never);
  assert.match(seen[0], /flags: --tdd/);
  assert.match(seen[1], /flags: --mvp/);
  // an action with no manager flag → no flags clause
  await dispatch({ action: "verify-work", phase: "1", reason: "" } as never);
});
