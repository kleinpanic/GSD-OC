import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { executePath, type StepOutcome } from "../src/orchestrate/execute-path.js";
import { selectPath } from "../src/orchestrate/select-path.js";
import { route } from "../src/engine/route.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => join(here, "..", "..", "test", "fixtures", name);
const ok = async (): Promise<StepOutcome> => ({ ok: true });

test("executePath HALTS at the first decision gate by default (ENF-01 enforced)", async () => {
  const path = selectPath({ intent: "build a feature", retrieved: [] });
  const r = await executePath(path, ok);
  assert.equal(r.completed, false);
  assert.equal(r.reason, "gate");
  assert.equal(r.haltedAt, "discuss");
});

test("executePath with autoGates runs the whole path to completion", async () => {
  const path = selectPath({ intent: "build a feature", retrieved: [] });
  const r = await executePath(path, ok, { autoGates: true });
  assert.equal(r.completed, true);
  assert.equal(r.steps.length, path.length);
  assert.ok(r.steps.every((s) => s.status === "done"));
});

test("executePath HALTS on a failed step (enforced, not advisory)", async () => {
  const path = selectPath({ intent: "build a feature", retrieved: [] });
  let n = 0;
  const dispatch = async (): Promise<StepOutcome> => (++n === 3 ? { ok: false, output: "boom" } : { ok: true });
  const r = await executePath(path, dispatch, { autoGates: true });
  assert.equal(r.completed, false);
  assert.equal(r.reason, "failure");
  assert.equal(r.steps[2].status, "failed");
});

test("executePath surfaces a gate the dispatcher signals mid-run", async () => {
  const path = selectPath({ intent: "build a feature", retrieved: [] });
  let n = 0;
  const dispatch = async (): Promise<StepOutcome> => (++n === 2 ? { ok: true, gated: true } : { ok: true });
  const r = await executePath(path, dispatch, { autoGates: true });
  assert.equal(r.reason, "gate");
});

test("WR-03: an empty path is NOT a vacuous success — reason 'empty', completed false", async () => {
  const r = await executePath([], ok);
  assert.equal(r.completed, false);
  assert.equal(r.reason, "empty");
  assert.equal(r.haltedAt, null);
  assert.equal(r.steps.length, 0);
});

test("executePath: a gate at index 0 halts immediately (one gated step recorded)", async () => {
  const path = [{ verb: "discuss", skill: "gsd-discuss-phase", reason: "gate", gate: true }];
  const r = await executePath(path, ok);
  assert.equal(r.completed, false);
  assert.equal(r.reason, "gate");
  assert.equal(r.haltedAt, "discuss");
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].status, "gated");
});

test("executePath: two gates → halts at the FIRST", async () => {
  const path = [
    { verb: "discuss", skill: "gsd-discuss-phase", reason: "gate", gate: true },
    { verb: "plan", skill: "gsd-plan-phase", reason: "gate", gate: true },
  ];
  const r = await executePath(path, ok);
  assert.equal(r.haltedAt, "discuss");
  assert.equal(r.steps.length, 1);
});

test("executePath: a dispatcher-signalled gate (gated:true) yields reason 'gate'", async () => {
  const path = [{ verb: "execute", skill: "gsd-quick", reason: "core", gate: false }];
  const gatedDispatch = async (): Promise<StepOutcome> => ({ ok: true, gated: true });
  const r = await executePath(path, gatedDispatch, { autoGates: true });
  assert.equal(r.reason, "gate");
  assert.equal(r.haltedAt, "execute");
});

test("executePath: a THROWING dispatcher becomes a failure carrying the error message", async () => {
  const path = selectPath({ intent: "build a feature", retrieved: [] });
  const dispatch = async (): Promise<StepOutcome> => {
    throw new Error("network down");
  };
  const r = await executePath(path, dispatch, { autoGates: true });
  assert.equal(r.completed, false);
  assert.equal(r.reason, "failure");
  assert.equal(r.steps.at(-1)!.output, "network down");
});

// ── state-machine completion (codex F2) ──

test("route: last phase verified (passing VERIFICATION.md) → complete-milestone reachable", () => {
  assert.equal(route(fx("route-complete")).action, "verify-work");
  const r = route(fx("route-verified"));
  assert.equal(r.action, "complete-milestone");
  assert.equal(r.reason, "all-complete");
});
