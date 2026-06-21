import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPhase, nextPhaseNumber, scaffoldPhaseDir, updatePlanProgress, markPhaseComplete, markRequirementComplete, completeMilestone } from "../src/engine/lifecycle.js";
import { route } from "../src/engine/route.js";

function tmpPlanning(roadmap = "# Roadmap\n"): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-lc-"));
  const p = join(dir, ".planning");
  mkdirSync(join(p, "phases"), { recursive: true });
  writeFileSync(join(p, "ROADMAP.md"), roadmap);
  writeFileSync(join(p, "STATE.md"), "---\nstatus: planning\n---\n# State\n");
  return p;
}

test("addPhase appends a route()-PARSEABLE phase block (the write→read guarantee)", () => {
  const p = tmpPlanning();
  try {
    assert.equal(nextPhaseNumber(p), 1);
    const a = addPhase(p, "Add auth", { goal: "wire OAuth" });
    assert.equal(a.number, 1);
    const b = addPhase(p, "Add billing");
    assert.equal(b.number, 2);
    // the REAL test: route() must see the phases we wrote
    const r = route(p);
    assert.equal(r.phase, "1", "route() picks up the first written phase");
    assert.match(readFileSync(join(p, "ROADMAP.md"), "utf8"), /### Phase 2: Add billing/);
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("scaffoldPhaseDir creates phases/NN-slug", () => {
  const p = tmpPlanning();
  try {
    const dir = scaffoldPhaseDir(p, 3, "Add Auth Flow!");
    assert.ok(existsSync(dir));
    assert.match(dir, /phases\/03-add-auth-flow$/);
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("updatePlanProgress + markPhaseComplete rewrite the phase block", () => {
  const p = tmpPlanning();
  try {
    addPhase(p, "Foo");
    assert.ok(updatePlanProgress(p, 1, 4, 2));
    assert.match(readFileSync(join(p, "ROADMAP.md"), "utf8"), /\*\*Plans:\*\* 4 plans \(2 done\)/);
    assert.ok(markPhaseComplete(p, 1));
    assert.match(readFileSync(join(p, "ROADMAP.md"), "utf8"), /\*\*Status:\*\* Complete/);
    assert.equal(updatePlanProgress(p, 9, 1), false, "missing phase → false");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("markRequirementComplete checks off a REQ id", () => {
  const p = tmpPlanning();
  try {
    writeFileSync(join(p, "REQUIREMENTS.md"), "# Requirements\n- [ ] **RET-01**: corpus\n- [ ] AUTH-02: login\n");
    assert.ok(markRequirementComplete(p, "RET-01"));
    assert.match(readFileSync(join(p, "REQUIREMENTS.md"), "utf8"), /- \[x\] \*\*RET-01\*\*/);
    assert.ok(markRequirementComplete(p, "AUTH-02"));
    assert.equal(markRequirementComplete(p, "NOPE-99"), false);
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("completeMilestone archives phases/ + resets it", () => {
  const p = tmpPlanning();
  try {
    scaffoldPhaseDir(p, 1, "x");
    const r = completeMilestone(p, "v1.1");
    assert.ok(r.archived);
    assert.ok(existsSync(join(p, "milestones", "v1.1-phases", "01-x")), "phases archived");
    assert.ok(existsSync(join(p, "phases")), "fresh phases/ for next milestone");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});
