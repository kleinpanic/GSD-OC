import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  normalizePhaseName,
  comparePhaseNum,
  isCanonicalPlanFile,
  isCanonicalSummaryFile,
  findPhase,
  nextDecimalPhase,
} from "../src/engine/phase.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "..", "test", "fixtures", "engine-phase");

test("normalizePhaseName pads, keeps decimals, strips project code", () => {
  assert.equal(normalizePhaseName("2"), "02");
  assert.equal(normalizePhaseName("2.1"), "02.1");
  assert.equal(normalizePhaseName("CK-02"), "02");
});

test("comparePhaseNum: integer before its decimals, numeric ordering", () => {
  const sorted = ["02.1", "01", "02"].sort(comparePhaseNum);
  assert.deepEqual(sorted, ["01", "02", "02.1"]);
});

test("isCanonicalPlanFile / isCanonicalSummaryFile reject non-canonical shapes", () => {
  assert.equal(isCanonicalPlanFile("02-01-PLAN.md"), true);
  assert.equal(isCanonicalPlanFile("PLAN.md"), true);
  assert.equal(isCanonicalPlanFile("PLAN-02.md"), false);
  assert.equal(isCanonicalPlanFile("02-01-PLAN-OUTLINE.md"), false);
  assert.equal(isCanonicalSummaryFile("02-01-SUMMARY.md"), true);
  assert.equal(isCanonicalSummaryFile("SUMMARY.md"), true);
  assert.equal(isCanonicalSummaryFile("02-01-PLAN.md"), false);
});

test("findPhase('2') returns 2 plans, 0 summaries (incomplete)", () => {
  const r = findPhase(fixture, "2");
  assert.equal(r.found, true);
  assert.equal(r.phase_number, "02");
  assert.deepEqual(r.plans, ["02-01-PLAN.md", "02-02-PLAN.md"]);
  assert.deepEqual(r.summaries, []);
  assert.ok(r.plans.length > r.summaries.length, "phase 2 is incomplete-execution");
});

test("findPhase('1') is complete (plans.length === summaries.length)", () => {
  const r = findPhase(fixture, "1");
  assert.equal(r.found, true);
  assert.deepEqual(r.plans, ["01-01-PLAN.md"]);
  assert.deepEqual(r.summaries, ["01-01-SUMMARY.md"]);
  assert.equal(r.plans.length, r.summaries.length);
});

test("findPhase('2.1') resolves the decimal directory", () => {
  const r = findPhase(fixture, "2.1");
  assert.equal(r.found, true);
  assert.equal(r.phase_number, "02.1");
  assert.deepEqual(r.plans, ["02.1-01-PLAN.md"]);
});

test("findPhase of an absent phase returns found:false", () => {
  const r = findPhase(fixture, "9");
  assert.equal(r.found, false);
  assert.deepEqual(r.plans, []);
});

test("nextDecimalPhase computes N.(max+1) and N.1 when none exist", () => {
  // fixture has 02.1-hotfix → next under base 2 is 2.2
  assert.equal(nextDecimalPhase(fixture, "2"), "2.2");
  // no decimal dirs under base 1 → 1.1
  assert.equal(nextDecimalPhase(fixture, "1"), "1.1");
});

test("L-02: nextDecimalPhase throws on a decimal basePhase instead of silently rebasing", () => {
  // Pre-fix: "2.3" was parseInt'd to 2, silently computing children of phase 2.
  assert.throws(() => nextDecimalPhase(fixture, "2.3"), /must be an integer phase/);
  assert.throws(() => nextDecimalPhase(fixture, "2.1"), /must be an integer phase/);
});
