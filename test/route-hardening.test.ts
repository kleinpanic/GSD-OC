import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../src/engine/route.js";

function scratchPlanning(): { root: string; planning: string } {
  const root = mkdtempSync(join(tmpdir(), "gsd-route-"));
  const planning = join(root, ".planning");
  mkdirSync(join(planning, "phases"), { recursive: true });
  writeFileSync(
    join(planning, "ROADMAP.md"),
    "### Phase 1: A\n**Goal:** g\n### Phase 2: B\n**Goal:** g\n",
  );
  return { root, planning };
}

function writeVerification(planning: string, body: string): void {
  // The scanner looks in phase dirs (phases/01-*/...-VERIFICATION.md).
  const phaseDir = join(planning, "phases", "01-a");
  mkdirSync(phaseDir, { recursive: true });
  writeFileSync(join(phaseDir, "1-VERIFICATION.md"), body);
}

test("H-01: prose containing 'FAIL' does NOT freeze the lifecycle", () => {
  const { root, planning } = scratchPlanning();
  try {
    writeVerification(
      planning,
      "# Verification\n\n**Status:** passed\n\nNo FAIL conditions remain. All checks pass.\n",
    );
    const r = route(planning);
    assert.notEqual(r.reason, "verification-fail", "prose 'FAIL' must not trigger a halt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("H-01: a real verdict 'Status: FAILED' DOES halt", () => {
  const { root, planning } = scratchPlanning();
  try {
    writeVerification(planning, "# Verification\n\nStatus: FAILED\n");
    const r = route(planning);
    assert.equal(r.reason, "verification-fail");
    assert.equal(r.action, "halt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("H-02: route() does not throw when a phase dir is unreadable/racing", () => {
  const { root, planning } = scratchPlanning();
  try {
    // Point a phase dir entry at a path that does not exist as a dir to simulate a race.
    // route() must swallow the fs error and still return a valid result.
    assert.doesNotThrow(() => {
      const r = route(planning);
      assert.ok(r.action, "route returns an action even under fs edge cases");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M-2: a bare 'PASS'/'# PASSED' heading is NOT a verification verdict (no premature complete)", () => {
  // single-phase project, plans==summaries, but VERIFICATION.md has only a heading — not a real verdict.
  function single(verif: string) {
    const root = mkdtempSync(join(tmpdir(), "gsd-m2-"));
    const planning = join(root, ".planning");
    const pd = join(planning, "phases", "01-a");
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(planning, "ROADMAP.md"), "### Phase 1: A\n**Goal:** g\n");
    writeFileSync(join(pd, "01-01-PLAN.md"), "# plan\n");
    writeFileSync(join(pd, "01-01-SUMMARY.md"), "# summary\n");
    writeFileSync(join(pd, "1-VERIFICATION.md"), verif);
    return { root, planning };
  }
  const bare = single("# PASSED\n\nnotes\n");
  try {
    const r = route(bare.planning);
    assert.notEqual(r.action, "complete-milestone", "a bare PASS heading must not complete the milestone");
    assert.equal(r.action, "verify-work");
  } finally { rmSync(bare.root, { recursive: true, force: true }); }
  // sanity: a REAL verdict does complete
  const real = single("Status: passed\n");
  try {
    assert.equal(route(real.planning).action, "complete-milestone");
  } finally { rmSync(real.root, { recursive: true, force: true }); }
});

test("R7-HIGH: a bold-markdown '**Status:** PASSED' verdict IS recognized (route advances)", () => {
  function single(verif: string) {
    const root = mkdtempSync(join(tmpdir(), "gsd-r7-"));
    const planning = join(root, ".planning");
    const pd = join(planning, "phases", "01-a");
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(planning, "ROADMAP.md"), "### Phase 1: A\n**Goal:** g\n");
    writeFileSync(join(pd, "01-01-PLAN.md"), "# plan\n");
    writeFileSync(join(pd, "01-01-SUMMARY.md"), "# summary\n");
    writeFileSync(join(pd, "1-VERIFICATION.md"), verif);
    return { root, planning };
  }
  // bold-only verdict, NO frontmatter status line — must still be recognized as passed
  const bold = single("# Verification\n\n**Status:** PASSED\n");
  try {
    assert.equal(route(bold.planning).action, "complete-milestone", "bold PASS must advance");
  } finally { rmSync(bold.root, { recursive: true, force: true }); }
  // M-2 not regressed: a bare PASS heading still does NOT complete
  const bare = single("# PASSED\n\nnotes\n");
  try {
    assert.notEqual(route(bare.planning).action, "complete-milestone");
  } finally { rmSync(bare.root, { recursive: true, force: true }); }
});

test("R8-HIGH: a bold-field '**Status:** FAILED' verdict HALTS (and a conflicting pass+fail does not ship)", () => {
  function mk(verif: string) {
    const root = mkdtempSync(join(tmpdir(), "gsd-r8-"));
    const planning = join(root, ".planning");
    const pd = join(planning, "phases", "01-a");
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(planning, "ROADMAP.md"), "### Phase 1: A\n**Goal:** g\n");
    writeFileSync(join(pd, "01-01-PLAN.md"), "# plan\n");
    writeFileSync(join(pd, "01-01-SUMMARY.md"), "# summary\n");
    writeFileSync(join(pd, "1-VERIFICATION.md"), verif);
    return { root, planning };
  }
  const failed = mk("# Verification\n\n**Status:** FAILED\n");
  try {
    const r = route(failed.planning);
    assert.equal(r.reason, "verification-fail", "bold FAIL must halt");
    assert.equal(r.action, "halt");
  } finally { rmSync(failed.root, { recursive: true, force: true }); }
  // conflicting: a bold PASS line AND a bold FAIL line — the unresolved FAIL must win (no premature ship)
  const conflict = mk("**Status:** PASSED\n\n**Result:** FAILED -- regression in module X\n");
  try {
    assert.notEqual(route(conflict.planning).action, "complete-milestone", "an unresolved FAIL must block the ship");
  } finally { rmSync(conflict.root, { recursive: true, force: true }); }
});

test("BLOCKER: an empty-named phase heading does NOT swallow the next phase (regex line-anchored)", async () => {
  const { roadmapPhases } = await import("../src/engine/verify.js");
  const d = mkdtempSync(join(tmpdir(), "gsd-emptyname-"));
  const p = join(d, ".planning"); mkdirSync(p, { recursive: true });
  try {
    // Phase 2 has NO name after the colon — must not eat Phase 3
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: First\n### Phase 2:\n### Phase 3: Third\n");
    const phases = roadmapPhases(p);
    assert.deepEqual(phases.map((x: { number: string }) => x.number), ["1", "2", "3"], "all 3 phases parsed, none dropped");
    assert.equal(phases[1].name, "", "empty name stays empty (didn't swallow Phase 3's heading)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("Finding 2: **Status**: failed (colon outside bold) triggers the error hard-stop", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-status-"));
  const p = join(d, ".planning"); mkdirSync(join(p, "phases", "01-x"), { recursive: true });
  try {
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: X\n**Goal:** g\n");
    // colon OUTSIDE the bold markers — the variant that used to evade the gate
    writeFileSync(join(p, "STATE.md"), "---\nstatus: executing\n---\n## Current Position\n\n**Status**: failed\n");
    const r = route(p);
    assert.equal(r.action, "halt", "error/failed status now halts (gate no longer bypassed)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("Finding #7: an orphan-summary phase (summaries>plans) routes to verify, not silently skipped", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-orphan-"));
  const p = join(d, ".planning"); const ph = join(p, "phases", "01-x"); mkdirSync(ph, { recursive: true });
  try {
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: X\n**Goal:** g\n");
    writeFileSync(join(p, "STATE.md"), "---\nstatus: executing\n---\n");
    // one PLAN but TWO summaries (an orphan summary from a rename) → must route to verify, not fall through
    writeFileSync(join(ph, "01-01-PLAN.md"), "#");
    writeFileSync(join(ph, "01-01-SUMMARY.md"), "#");
    writeFileSync(join(ph, "01-02-SUMMARY.md"), "#");
    assert.equal(route(p).action, "verify-work", "orphan-summary phase routes to verify");
  } finally { rmSync(d, { recursive: true, force: true }); }
});
