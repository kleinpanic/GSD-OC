import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextTemplate, planTemplate, summaryTemplate, verificationTemplate, artifactName } from "../src/engine/artifacts.js";
import { verifyPhaseCompleteness } from "../src/engine/verify.js";
import { route } from "../src/engine/route.js";

test("artifact templates round-trip through route()/verify() (the byte-grammar is correct)", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-art-"));
  const p = join(d, ".planning"); const ph = join(p, "phases", "01-x");
  mkdirSync(ph, { recursive: true });
  try {
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: X\n**Goal:** g\n");
    writeFileSync(join(p, "STATE.md"), "---\nstatus: executing\n---\n# State\n");
    // CONTEXT present → route advances past discuss to plan
    writeFileSync(join(ph, artifactName(1, "context")), contextTemplate(1, "X"));
    assert.equal(route(p).action, "plan-phase", "CONTEXT present → plan");
    // add PLAN → route advances to execute
    writeFileSync(join(ph, artifactName(1, "plan", 1)), planTemplate(1, 1, { goal: "do" }));
    assert.equal(route(p).action, "execute-phase", "PLAN present → execute");
    // add SUMMARY → verify pairs them (no missing-summary defect)
    writeFileSync(join(ph, artifactName(1, "summary", 1)), summaryTemplate(1, 1, { phaseName: "X" }));
    // add a PASSED VERIFICATION → phase complete
    writeFileSync(join(ph, artifactName(1, "verification")), verificationTemplate(1, "PASSED", { phaseName: "X" }));
    const vc = verifyPhaseCompleteness(p, "1");
    assert.ok(vc.ok, JSON.stringify(vc.defects));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("verificationTemplate emits the **Status:** PASSED line verify() keys on", () => {
  assert.match(verificationTemplate(2, "PASSED"), /\*\*Status:\*\* PASSED/);
  assert.match(verificationTemplate(2, "FAILED"), /\*\*Status:\*\* FAILED/);
  assert.equal(artifactName(3, "plan", 2), "03-02-PLAN.md");
  assert.equal(artifactName(3, "context"), "03-CONTEXT.md");
});
