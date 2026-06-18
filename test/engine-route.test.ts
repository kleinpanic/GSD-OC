import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { route } from "../src/engine/route.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => join(here, "..", "..", "test", "fixtures", name);

// ── Hard-stop gates ──

test("Gate 1: .continue-here.md halts with unresolved-checkpoint", () => {
  const r = route(fx("route-gates"));
  assert.equal(r.route, "halt");
  assert.equal(r.reason, "unresolved-checkpoint");
});

test("route() is pure: same dir → identical output, no side effects", () => {
  const a = route(fx("route-incomplete"));
  const b = route(fx("route-incomplete"));
  assert.deepEqual(a, b);
});

// ── Route 0: resume incomplete phase ──

test("Route 0: phase 1 (2 plans, 1 summary) resumes despite current_phase=2", () => {
  const r = route(fx("route-incomplete"));
  assert.equal(r.route, 0);
  assert.equal(r.action, "execute-phase");
  assert.equal(r.phase, "1");
  assert.equal(r.reason, "resume-incomplete");
});

// ── Routes 1-8 ──

test("Route 1: roadmap has phases but no phase dirs → discuss first phase", () => {
  const r = route(fx("route-no-context"));
  assert.equal(r.route, 1);
  assert.equal(r.action, "discuss-phase");
  assert.equal(r.phase, "1");
});

test("Route 3: phase has CONTEXT but no PLAN → plan-phase", () => {
  const r = route(fx("route-has-context"));
  assert.equal(r.route, 3);
  assert.equal(r.action, "plan-phase");
  assert.equal(r.phase, "1");
});

test("Route 5: all plans have summaries (last phase) → verify-work", () => {
  // route-complete: single-phase roadmap, phase 1 = 1 plan + 1 summary.
  // next.md §239 Route 5 fires when the current phase's plans all have summaries.
  const r = route(fx("route-complete"));
  assert.equal(r.route, 5);
  assert.equal(r.action, "verify-work");
  assert.equal(r.phase, "1");
});

test("Gate precedence: a gate fixture never reaches a forward route", () => {
  // route-gates has a STATE.md (Phase 1 of 2) but the .continue-here.md gate must win.
  const r = route(fx("route-gates"));
  assert.equal(r.route, "halt");
});
