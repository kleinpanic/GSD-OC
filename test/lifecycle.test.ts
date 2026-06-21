import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPhase, nextPhaseNumber, scaffoldPhaseDir, updatePlanProgress, markPhaseComplete, markRequirementComplete, completeMilestone, milestoneSummary } from "../src/engine/lifecycle.js";
import { setFrontmatterField } from "../src/engine/mutate.js";
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

test("completeMilestone archives phases/ + resets it + returns a summary", () => {
  const p = tmpPlanning();
  try {
    scaffoldPhaseDir(p, 1, "x");
    const r = completeMilestone(p, "v1.1");
    assert.ok(r.archived);
    assert.ok(existsSync(join(p, "milestones", "v1.1-phases", "01-x")), "phases archived");
    assert.ok(existsSync(join(p, "phases")), "fresh phases/ for next milestone");
    assert.equal(r.summary.version, "v1.1");
    assert.ok(existsSync(join(p, "MILESTONES.md")), "summary written");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("milestoneSummary aggregates stats, archives ROADMAP/REQ, prepends MILESTONES.md", () => {
  const p = tmpPlanning("# Roadmap\n\n### Phase 1: Foundations\n**Goal:** g\n");
  try {
    writeFileSync(join(p, "REQUIREMENTS.md"), "- REQ-1\n");
    const d1 = scaffoldPhaseDir(p, 1, "foundations");
    writeFileSync(join(d1, "01-01-PLAN.md"), "# plan\n");
    writeFileSync(join(d1, "01-01-SUMMARY.md"), "---\none-liner: Stood up the core engine.\n---\n# Summary\n\n**Tasks:** 4\n");
    const clock = { now: () => Date.parse("2026-06-21T00:00:00Z") };

    const s = milestoneSummary(p, "v1.0", { name: "Core", clock });
    assert.equal(s.phaseCount, 1);
    assert.equal(s.totalPlans, 1);
    assert.equal(s.totalTasks, 4);
    assert.deepEqual(s.accomplishments, ["Stood up the core engine."]);
    assert.deepEqual(s.archived.sort(), ["v1.0-REQUIREMENTS.md", "v1.0-ROADMAP.md"]);
    assert.ok(existsSync(join(p, "milestones", "v1.0-ROADMAP.md")));

    const ms = readFileSync(join(p, "MILESTONES.md"), "utf8");
    assert.match(ms, /## v1\.0 Core \(Shipped: 2026-06-21\)/);
    assert.match(ms, /1 phases, 1 plans, 4 tasks/);
    assert.match(ms, /- Stood up the core engine\./);

    // a second milestone prepends (reverse-chronological)
    milestoneSummary(p, "v2.0", { name: "Next", clock });
    const ms2 = readFileSync(join(p, "MILESTONES.md"), "utf8");
    assert.ok(ms2.indexOf("v2.0 Next") < ms2.indexOf("v1.0 Core"), "newest first");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("BLOCKER: markPhaseComplete refreshes a far Status in place (no duplicate line)", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-mpc-")); const p = join(d, ".planning"); mkdirSync(p, { recursive: true });
  try {
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: auth\n\n**Goal:** g\n**Requirements:** r\n**Depends-On:** x\n**Plans:** 0 plans\n**Status:** Pending\n");
    markPhaseComplete(p, 1); markPhaseComplete(p, 1);
    const out = readFileSync(join(p, "ROADMAP.md"), "utf8");
    assert.equal((out.match(/\*\*Status:\*\*/g) || []).length, 1, "exactly one Status line");
    assert.match(out, /\*\*Status:\*\* Complete/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("BLOCKER: setFrontmatterField updates in place when frontmatter isn't byte-0 (no duplicate block)", () => {
  const out = setFrontmatterField("\n---\nstatus: a\n---\nbody\n", "status", "b");
  assert.equal((out.match(/^---$/gm) || []).length, 2, "still exactly one frontmatter block (2 fences)");
  assert.match(out, /status: b/);
  assert.doesNotMatch(out, /status: a/, "old value gone, not orphaned");
});

test("updatePlanProgress inserts a **Plans:** line when the phase block lacks one (no silent no-op)", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-upp-")); const p = join(d, ".planning"); mkdirSync(p, { recursive: true });
  try {
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: a\n\n**Goal:** x\n");
    assert.equal(updatePlanProgress(p, 1, 3), true);
    assert.match(readFileSync(join(p, "ROADMAP.md"), "utf8"), /\*\*Plans:\*\* 3 plans/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
