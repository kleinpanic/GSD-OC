import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateArtifacts, verifyPhaseCompleteness, validateConsistency, validateHealth, roadmapPhases } from "../src/engine/verify.js";

function tmpP(): string {
  const d = mkdtempSync(join(tmpdir(), "gsd-vf-"));
  const p = join(d, ".planning"); mkdirSync(join(p, "phases"), { recursive: true });
  return p;
}

test("validateArtifacts: defects on missing/unparseable; ok on a valid set", () => {
  const p = tmpP();
  try {
    let r = validateArtifacts(p);
    assert.ok(!r.ok && r.defects.length >= 2, "missing ROADMAP+STATE+REQ");
    writeFileSync(join(p, "ROADMAP.md"), "# Roadmap\n### Phase 1: Foo\n**Goal:** g\n");
    writeFileSync(join(p, "STATE.md"), "---\nstatus: planning\n---\n");
    writeFileSync(join(p, "REQUIREMENTS.md"), "# Requirements\n- [ ] RET-01: x\n");
    r = validateArtifacts(p);
    assert.ok(r.ok, JSON.stringify(r.defects));
    // a phase without a Goal is a defect
    writeFileSync(join(p, "ROADMAP.md"), "# Roadmap\n### Phase 1: Foo\nno goal here\n");
    assert.ok(validateArtifacts(p, ["ROADMAP"]).defects.some((d) => /Goal/.test(d.missing)));
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("verifyPhaseCompleteness: plans==summaries + PASSED verification", () => {
  const p = tmpP();
  try {
    const pd = join(p, "phases", "01-foo"); mkdirSync(pd, { recursive: true });
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: Foo\n**Goal:** g\n");
    writeFileSync(join(pd, "01-01-PLAN.md"), "#");
    assert.ok(!verifyPhaseCompleteness(p, "1").ok, "no summary/verification");
    writeFileSync(join(pd, "01-01-SUMMARY.md"), "#");
    writeFileSync(join(pd, "1-VERIFICATION.md"), "**Status:** PASSED\n");
    assert.ok(verifyPhaseCompleteness(p, "1").ok, "complete");
    writeFileSync(join(pd, "1-VERIFICATION.md"), "**Status:** FAILED\n");
    assert.ok(!verifyPhaseCompleteness(p, "1").ok, "failed verdict");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("validateConsistency flags a phase marked Complete but unverified", () => {
  const p = tmpP();
  try {
    mkdirSync(join(p, "phases", "01-foo"), { recursive: true });
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: Foo\n**Goal:** g\n**Status:** Complete\n");
    assert.ok(!validateConsistency(p).ok, "complete-but-unverified");
    assert.ok(!validateHealth(p).ok);
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("roadmapPhases parses phase numbers + names", () => {
  const p = tmpP();
  try {
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: A\n## Phase 2.1: B\n");
    assert.deepEqual(roadmapPhases(p).map((x) => x.number), ["1", "2.1"]);
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});
