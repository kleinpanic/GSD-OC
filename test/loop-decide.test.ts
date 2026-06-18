import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideDispatch,
  buildSpawnInstruction,
  GATE_ACTIONS,
  MECHANICAL_ACTIONS,
  type DispatchDecision,
} from "../src/loop/decide.js";
import type { RouteResult } from "../src/engine/route.js";

const rr = (over: Partial<RouteResult>): RouteResult => ({
  route: 1,
  action: "discuss-phase",
  phase: "4",
  reason: "test",
  ...over,
});

test("decideDispatch: gate action discuss-phase → agent-driven with sessions_spawn instruction (ORCH-02)", () => {
  const d = decideDispatch(rr({ route: 1, action: "discuss-phase", phase: "4" }));
  assert.equal(d.mode, "agent-driven");
  if (d.mode !== "agent-driven") return;
  assert.equal(d.agentId, "gsd-planner");
  assert.match(d.instruction, /sessions_spawn/);
  assert.match(d.instruction, /gsd-planner/);
  assert.match(d.instruction, /sessions_yield/);
  assert.equal(d.phase, "4");
});

test("decideDispatch: verify-work → agent-driven, instruction contains sessions_spawn + gsd-verifier", () => {
  const d = decideDispatch(rr({ route: 5, action: "verify-work", phase: "4" }));
  assert.equal(d.mode, "agent-driven");
  if (d.mode !== "agent-driven") return;
  assert.equal(d.agentId, "gsd-verifier");
  assert.match(d.instruction, /sessions_spawn/);
  assert.match(d.instruction, /gsd-verifier/);
});

test("decideDispatch: plan-phase → code-driven research fan-out (ORCH-03)", () => {
  const d = decideDispatch(rr({ route: 3, action: "plan-phase", phase: "4" }));
  assert.equal(d.mode, "code-driven");
  if (d.mode !== "code-driven") return;
  assert.equal(d.agentId, "gsd-project-researcher");
  assert.equal(d.fanout.messages.length, 4, "plan-phase = 4x research fan-out");
  assert.equal(d.phase, "4");
});

test("decideDispatch: execute-phase → code-driven single lane", () => {
  const d = decideDispatch(rr({ route: 4, action: "execute-phase", phase: "4" }));
  assert.equal(d.mode, "code-driven");
  if (d.mode !== "code-driven") return;
  assert.equal(d.agentId, "gsd-executor");
  assert.equal(d.fanout.messages.length, 1);
});

test("decideDispatch: resume-work → code-driven single lane", () => {
  const d = decideDispatch(rr({ route: 8, action: "resume-work", phase: null }));
  assert.equal(d.mode, "code-driven");
  if (d.mode !== "code-driven") return;
  assert.equal(d.fanout.messages.length, 1);
});

test("decideDispatch: halt → terminal, no dispatch", () => {
  const d = decideDispatch(rr({ route: "halt", action: "halt", phase: null, reason: "error-state" }));
  assert.equal(d.mode, "terminal");
  if (d.mode !== "terminal") return;
  assert.equal(d.reason, "error-state");
});

test("decideDispatch: complete-milestone → terminal", () => {
  const d = decideDispatch(rr({ route: 7, action: "complete-milestone", phase: null }));
  assert.equal(d.mode, "terminal");
});

test("GATE_ACTIONS / MECHANICAL_ACTIONS are disjoint and cover the forward verbs", () => {
  for (const a of GATE_ACTIONS) assert.ok(!MECHANICAL_ACTIONS.has(a), `${a} must not be mechanical`);
  assert.ok(GATE_ACTIONS.has("discuss-phase"));
  assert.ok(GATE_ACTIONS.has("verify-work"));
  assert.ok(MECHANICAL_ACTIONS.has("plan-phase"));
  assert.ok(MECHANICAL_ACTIONS.has("execute-phase"));
  assert.ok(MECHANICAL_ACTIONS.has("resume-work"));
});

test("buildSpawnInstruction: bounded static text, no raw .planning/ file bodies (V5 mitigation)", () => {
  const text = buildSpawnInstruction("gsd-planner", "4");
  assert.match(text, /sessions_spawn/);
  assert.match(text, /gsd-planner/);
  assert.match(text, /sessions_yield/);
  // Must NOT contain a file path body marker — only verb/phase/agentId fields.
  assert.doesNotMatch(text, /\.planning\/phases\/.*\.md/);
});

test("decideDispatch is pure: same input → deep-equal output", () => {
  const input = rr({ route: 3, action: "plan-phase", phase: "4" });
  assert.deepEqual(decideDispatch(input), decideDispatch(input));
});

// Type-level sanity: DispatchDecision is a discriminated union over `mode`.
const _typecheck: DispatchDecision = { mode: "terminal", reason: "x" };
void _typecheck;
