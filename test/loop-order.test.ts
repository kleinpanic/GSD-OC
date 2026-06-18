import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { route } from "../src/engine/route.js";
import { decideDispatch } from "../src/loop/decide.js";

/**
 * ORCH-05 lifecycle-ordering proof (4-RESEARCH.md:756-762, route.ts:172-202).
 *
 * Builds a single-phase `.planning/` tree in a temp dir (mirroring engine-state.test.ts's
 * mkdtempSync pattern) and advances it through three stages, asserting the COMBINED
 * route()→decideDispatch output order: plan-phase (code-driven) → execute-phase
 * (code-driven) → verify-work (agent-driven gate). Assertions are on the decideDispatch
 * MODE + route action only — live dispatch is gateway-gated (Phase 7).
 */

const ROADMAP_ONE_PHASE = `# Roadmap

## Phase Details

### Phase 1: Foundation

Build the base.
`;

const STATE = `---
status: planning
---

# Project State

## Current Position

Phase: 1 of 1 (Foundation)
`;

function mkPlanning(): { dir: string; planning: string; phaseDir: string } {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "loop-order-"));
  const planning = join(dir, ".planning");
  const phaseDir = join(planning, "phases", "01-foundation");
  fs.mkdirSync(phaseDir, { recursive: true });
  fs.writeFileSync(join(planning, "ROADMAP.md"), ROADMAP_ONE_PHASE);
  fs.writeFileSync(join(planning, "STATE.md"), STATE);
  return { dir, planning, phaseDir };
}

test("ORCH-05: context→plans→summaries advances plan-phase → execute-phase → verify-work", () => {
  const { dir, planning, phaseDir } = mkPlanning();
  try {
    // ── Stage 1: CONTEXT present, no plans → plan-phase (code-driven). ──
    fs.writeFileSync(join(phaseDir, "1-CONTEXT.md"), "# Context\n");
    const r1 = route(planning);
    assert.equal(r1.action, "plan-phase", "stage 1 route");
    const d1 = decideDispatch(r1);
    assert.equal(d1.mode, "code-driven", "plan-phase is code-driven");

    // ── Stage 2: PLAN present, no summary → execute-phase (code-driven). ──
    fs.writeFileSync(join(phaseDir, "01-01-PLAN.md"), "# Plan\n");
    const r2 = route(planning);
    assert.equal(r2.action, "execute-phase", "stage 2 route");
    const d2 = decideDispatch(r2);
    assert.equal(d2.mode, "code-driven", "execute-phase is code-driven");

    // ── Stage 3: SUMMARY present (last phase, all plans summarized) → verify-work (gate). ──
    fs.writeFileSync(join(phaseDir, "01-01-SUMMARY.md"), "# Summary\n");
    const r3 = route(planning);
    assert.equal(r3.action, "verify-work", "stage 3 route");
    const d3 = decideDispatch(r3);
    assert.equal(d3.mode, "agent-driven", "verify-work is an agent-driven gate");
    if (d3.mode === "agent-driven") {
      assert.equal(d3.agentId, "gsd-verifier");
      assert.match(d3.instruction, /sessions_spawn/);
    }

    // ── Combined ordering invariant (ORCH-05). ──
    const order = [r1.action, r2.action, r3.action];
    assert.deepEqual(order, ["plan-phase", "execute-phase", "verify-work"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ORCH-05: no-context stage routes to discuss-phase (agent-driven gate) ahead of plan", () => {
  const { dir, planning } = mkPlanning();
  try {
    // phases/ dir exists but the phase dir has neither CONTEXT nor RESEARCH → discuss.
    const r = route(planning);
    assert.equal(r.action, "discuss-phase");
    const d = decideDispatch(r);
    assert.equal(d.mode, "agent-driven", "discuss-phase is an agent-driven gate");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
