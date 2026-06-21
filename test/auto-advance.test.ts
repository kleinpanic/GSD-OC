import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideFinalize,
  type BeforeAgentFinalizeEvent,
} from "../src/hooks/auto-advance.js";
import type { RouteResult } from "../src/engine/route.js";

const ev = (over: Partial<BeforeAgentFinalizeEvent> = {}): BeforeAgentFinalizeEvent => ({
  sessionId: "s1",
  stopHookActive: false,
  ...over,
});

const rr = (over: Partial<RouteResult>): RouteResult => ({
  route: 4,
  action: "execute-phase",
  phase: "4",
  reason: "test",
  ...over,
});

test("decideFinalize: code-driven advance → revise with idempotencyKey + maxAttempts (ORCH-04)", () => {
  const r = decideFinalize(ev(), rr({ route: 4, action: "execute-phase", phase: "4" }));
  assert.equal(r.action, "revise");
  assert.equal(r.reason, "gsd-auto-advance");
  assert.ok(r.retry);
  assert.equal(r.retry!.idempotencyKey, "gsd:4:execute-phase");
  assert.equal(r.retry!.maxAttempts, 2);
  assert.equal(typeof r.retry!.instruction, "string");
  assert.ok(r.retry!.instruction.length > 0);
});

test("decideFinalize: GUARD stopHookActive=true → continue (no revise, loop guard, D-06)", () => {
  const r = decideFinalize(ev({ stopHookActive: true }), rr({ route: 4, action: "execute-phase" }));
  assert.equal(r.action, "continue");
  assert.equal(r.retry, undefined);
});

test("decideFinalize: route halt → continue (no revise past a hard-stop)", () => {
  const r = decideFinalize(ev(), rr({ route: "halt", action: "halt", phase: null, reason: "error-state" }));
  assert.equal(r.action, "continue");
});

test("decideFinalize: gate action discuss-phase → continue (let agent-driven gate run)", () => {
  const r = decideFinalize(ev(), rr({ route: 1, action: "discuss-phase", phase: "4" }));
  assert.equal(r.action, "continue");
});

test("decideFinalize: gate action verify-work → continue", () => {
  const r = decideFinalize(ev(), rr({ route: 5, action: "verify-work", phase: "4" }));
  assert.equal(r.action, "continue");
});

test("decideFinalize: complete-milestone → continue (terminal, no advance)", () => {
  const r = decideFinalize(ev(), rr({ route: 7, action: "complete-milestone", phase: null }));
  assert.equal(r.action, "continue");
});

test("decideFinalize: plan-phase (mechanical) → revise (code-driven advance)", () => {
  const r = decideFinalize(ev(), rr({ route: 3, action: "plan-phase", phase: "4" }));
  assert.equal(r.action, "revise");
  assert.equal(r.retry!.idempotencyKey, "gsd:4:plan-phase");
});

test("decideFinalize: maxAttempts is a bounded integer (2)", () => {
  const r = decideFinalize(ev(), rr({ route: 4, action: "execute-phase", phase: "4" }));
  assert.equal(Number.isInteger(r.retry!.maxAttempts), true);
  assert.ok(r.retry!.maxAttempts! <= 2);
});

test("decideFinalize: drives THROUGH a human gate only when autoGates (/goal mode)", () => {
  const ev = { sessionId: "s", stopHookActive: false };
  const gate = { route: "discuss", action: "discuss-phase", phase: "1", reason: "" } as never;
  // default: a gate stops for approval
  assert.equal(decideFinalize(ev as never, gate).action, "continue");
  // autonomous: drive through it (revise)
  assert.equal(decideFinalize(ev as never, gate, { autoGates: true }).action, "revise");
  // terminal ALWAYS stops, even autonomous
  const done = { route: "complete-milestone", action: "complete-milestone", phase: null, reason: "" } as never;
  assert.equal(decideFinalize(ev as never, done, { autoGates: true }).action, "continue");
});

test("C-2: verify-work NEVER auto-drives without explicit autoVerify (autoGates alone is not enough)", () => {
  const ev = { sessionId: "s", stopHookActive: false };
  const verify = { route: "verify-work", action: "verify-work", phase: "1", reason: "" } as never;
  assert.equal(decideFinalize(ev as never, verify, { autoGates: true }).action, "continue", "autoGates alone stops at verify");
  assert.equal(decideFinalize(ev as never, verify, { autoGates: true, autoVerify: true }).action, "revise", "explicit autoVerify drives it");
  // discuss still auto-drives with just autoGates
  const discuss = { route: "discuss", action: "discuss-phase", phase: "1", reason: "" } as never;
  assert.equal(decideFinalize(ev as never, discuss, { autoGates: true }).action, "revise");
});
