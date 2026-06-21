import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectStats } from "../src/engine/stats.js";
import { scratchProject, cleanupAllScratch } from "./helpers/scratch.js";

after(cleanupAllScratch);

test("projectStats aggregates phases, plans/summaries, requirements + milestone", () => {
  const { planning } = scratchProject("stats", {
    "ROADMAP.md": [
      "# Roadmap — Demo Project",
      "",
      "### Phase 1: Foundations",
      "**Goal:** stand up the core. Covers REQ-1, REQ-2.",
      "",
      "### Phase 2: Polish",
      "**Goal:** finish the edges.",
      "",
    ].join("\n"),
    "STATE.md": 'milestone_version: "1.0"\n',
    "REQUIREMENTS.md": "- REQ-1 foo\n- REQ-2 bar\n- REQ-3 baz (uncovered)\n",
  });

  // phase 1: a plan + summary + a PASSED verification → counts as completed
  const p1 = join(planning, "phases", "01-foundations");
  mkdirSync(p1, { recursive: true });
  writeFileSync(join(p1, "01-01-PLAN.md"), "# plan\nREQ-1 REQ-2\n");
  writeFileSync(join(p1, "01-01-SUMMARY.md"), "# summary\n");
  writeFileSync(join(p1, "01-VERIFICATION.md"), "status: passed\n");

  // phase 2: a plan only, no summary, no verification → not completed
  const p2 = join(planning, "phases", "02-polish");
  mkdirSync(p2, { recursive: true });
  writeFileSync(join(p2, "02-01-PLAN.md"), "# plan\n");

  const s = projectStats(planning);

  assert.equal(s.phases.total, 2);
  assert.equal(s.phases.completed, 1);
  assert.equal(s.phases.percent, 50);

  assert.equal(s.plans.total, 2);
  assert.equal(s.plans.summaries, 1);
  assert.equal(s.plans.percent, 50);

  assert.equal(s.requirements.total, 3);
  assert.equal(s.requirements.covered, 2, "REQ-3 is uncovered");
  assert.equal(s.requirements.percent, 67);

  assert.equal(s.milestone.version, "1.0");
  assert.equal(s.milestone.name, "Demo Project");

  // perPhase carries the per-phase verdict
  const ph1 = s.perPhase.find((p) => p.number === "1");
  assert.equal(ph1?.verification, "passed");
  assert.equal(ph1?.plans, 1);
  assert.equal(ph1?.summaries, 1);
});

test("projectStats degrades to zeros on an empty .planning (never throws)", () => {
  const { planning } = scratchProject("stats-empty", {});
  const s = projectStats(planning);
  assert.equal(s.phases.total, 0);
  assert.equal(s.phases.percent, 0);
  assert.equal(s.requirements.total, 0);
  assert.equal(s.milestone.name, null);
});
