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

// ── CR-01: a NON-LAST complete phase must verify before the walk advances ──

test("CR-01: non-last complete-but-unverified phase → verify-work phase 1 (not discuss phase 2)", () => {
  // route-unverified-nonlast: ROADMAP Phase1+Phase2; phase 1 has plan+summary (no
  // VERIFICATION.md); phase 2 dir absent. Pre-fix the isLast special-case let phase 1 fall
  // through and surfaced discuss-phase phase 2 (skipping verification). Now Route 5 fires for
  // phase 1 until it is verified — for non-last phases too.
  const r = route(fx("route-unverified-nonlast"));
  assert.equal(r.route, 5);
  assert.equal(r.action, "verify-work");
  assert.equal(r.phase, "1");
  assert.equal(r.reason, "all-summaries");
});

// ── CR-02: verificationPassed must not false-positive on prose ──

test("CR-02: prose 'the final verdict = passed by reviewer' → verify-work (not complete-milestone)", () => {
  // route-prose-verdict: single complete phase; VERIFICATION body has only a prose mention of
  // "verdict = passed". The anchored verdict regex must NOT treat this as a pass, so the phase
  // stays at Route 5 (verify-work) rather than reaching Route 7.
  const r = route(fx("route-prose-verdict"));
  assert.equal(r.route, 5);
  assert.equal(r.action, "verify-work");
  assert.equal(r.phase, "1");
});

test("CR-02 regression: status: passed → complete-milestone still reachable", () => {
  // route-verified: single phase with a real `status: passed` verdict → Route 7.
  const r = route(fx("route-verified"));
  assert.equal(r.route, 7);
  assert.equal(r.action, "complete-milestone");
});

// ── WR-02 / WR-01: body Status precedence + quote stripping ──

test("WR-02: body Status: \"failed\" (quoted) → halt error-state", () => {
  const r = route(fx("route-quoted-failed"));
  assert.equal(r.route, "halt");
  assert.equal(r.reason, "error-state");
});

test("WR-01: frontmatter status: active + body Status: error → halt (body overrides)", () => {
  // Mirrors read-state.ts precedence: the `## Current Position` body Status wins over the
  // frontmatter scalar, so a human-set body `error` halts.
  const r = route(fx("route-body-precedence"));
  assert.equal(r.route, "halt");
  assert.equal(r.reason, "error-state");
});

// ── Decimal phase ordering ──

test("route-decimal: phase 2 (plan, no summary) executes before 2.1 (comparePhaseNum 2<2.1)", () => {
  // ROADMAP Phase1,Phase2,Phase2.1; phase 1 complete+verified, phase 2 has a plan but no
  // summary. Route 0 resumes the first incomplete phase in comparePhaseNum order → phase 2.
  const r = route(fx("route-decimal"));
  assert.equal(r.action, "execute-phase");
  assert.equal(r.phase, "2");
});

// ── Route-precedence locks ──

test("Lock: paused_at set AND a phase plans>summaries → Route 0 resume wins over Route 8", () => {
  const r = route(fx("route-paused-resume"));
  assert.equal(r.route, 0);
  assert.equal(r.action, "execute-phase");
  assert.equal(r.phase, "1");
  assert.equal(r.reason, "resume-incomplete");
});

test("Lock: paused_at with empty value does NOT trigger Route 8", () => {
  // route-paused-empty: `paused_at:` with no value; the phase is complete+verified, so the
  // route must reach Route 7 (complete-milestone), proving the empty paused_at was ignored.
  const r = route(fx("route-paused-empty"));
  assert.notEqual(r.route, 8);
  assert.equal(r.route, 7);
  assert.equal(r.action, "complete-milestone");
});
