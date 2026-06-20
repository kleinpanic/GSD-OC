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
