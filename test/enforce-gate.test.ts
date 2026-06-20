import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { enforceToolGate } from "../src/hooks/enforce-gate.js";

const fxRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures");
const edit = { toolName: "edit", params: { file: "x.ts" } };

/** Build a coding-workspace tmp dir (carries .git marker) with a given .planning fixture copied in. */
function ws(planningFixture: string | null) {
  const dir = mkdtempSync(join(homedir(), "codeWS", "gsd-enf-"));
  mkdirSync(join(dir, ".git"), { recursive: true });
  if (planningFixture) {
    // mirror the fixture's files under <dir>/.planning
    const src = join(fxRoot, planningFixture);
    mkdirSync(join(dir, ".planning"), { recursive: true });
    cpSync(src, join(dir, ".planning"), { recursive: true });
  }
  return dir;
}

test("ENF: non-mutating tool is never blocked", () => {
  const dir = ws("route-no-context");
  try {
    assert.equal(enforceToolGate({ toolName: "read", params: {} }, {}, { cwd: dir }), undefined);
    assert.equal(enforceToolGate({ toolName: "exec", params: {} }, {}, { cwd: dir }), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF: edit BLOCKED when GSD says discuss/plan (pre-build) — the enforcement keystone", () => {
  // route-no-context: roadmap with phases but no CONTEXT → route returns discuss-phase (phase 1).
  const dir = ws("route-no-context");
  try {
    const r = enforceToolGate(edit, {}, { cwd: dir });
    assert.ok(r && r.block === true, "edit before planning must be blocked");
    assert.match(r!.blockReason!, /not planned yet|gsd_orchestrate/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF: edit ALLOWED once planning is done (route says execute/verify)", () => {
  // route-complete: plans + summaries → route returns verify-work (past planning) → allow edits.
  const dir = ws("route-complete");
  try {
    assert.equal(enforceToolGate(edit, {}, { cwd: dir }), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF: greenfield (no .planning) is NOT blocked — never bricks a fresh project", () => {
  const dir = ws(null);
  try {
    assert.equal(enforceToolGate(edit, {}, { cwd: dir }), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF: non-coding workspace is never gated", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-noenf-")); // no markers
  try {
    assert.equal(enforceToolGate(edit, {}, { cwd: dir }), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF: .gsd-off opt-out disables the gate even pre-planning", () => {
  const dir = ws("route-no-context");
  try {
    writeFileSync(join(dir, ".gsd-off"), "");
    assert.equal(enforceToolGate(edit, {}, { cwd: dir }), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF: workflow.enforce_tool_gate:false disables the gate", () => {
  const dir = ws("route-no-context");
  try {
    writeFileSync(join(dir, ".planning", "config.json"), JSON.stringify({ workflow: { enforce_tool_gate: false } }));
    assert.equal(enforceToolGate(edit, {}, { cwd: dir }), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { enforceSpawnPersona } from "../src/hooks/enforce-gate.js";

test("ENF-SPAWN: a subagent spawn in a GSD workspace gets the matching GSD persona injected", () => {
  const dir = ws(null); // coding workspace (has .git), greenfield is fine — spawn enforcement is independent of route
  try {
    const r = enforceSpawnPersona({ toolName: "sessions_spawn", params: { agentId: "dev", message: "plan the auth phase" } }, {}, { cwd: dir });
    assert.ok(r && r.params, "spawn params rewritten");
    const msg = String((r!.params as { message: string }).message);
    assert.match(msg, /GSD \*\*gsd-planner\*\* subagent/, "planner persona injected for a planning task");
    assert.match(msg, /--- Task ---\nplan the auth phase/, "original task preserved after the persona");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF-SPAWN: a debug task routes to the gsd-debugger persona; default is gsd-executor", () => {
  const dir = ws(null);
  try {
    const dbg = enforceSpawnPersona({ toolName: "sessions_spawn", params: { message: "the build is flaky, debug it" } }, {}, { cwd: dir });
    assert.match(String((dbg!.params as { message: string }).message), /gsd-debugger/);
    const def = enforceSpawnPersona({ toolName: "sessions_spawn", params: { message: "do the thing" } }, {}, { cwd: dir });
    assert.match(String((def!.params as { message: string }).message), /gsd-executor/, "no clear role → still a GSD persona, never bare");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF-SPAWN: non-spawn tool + already-GSD spawn + non-coding ws are left alone", () => {
  const dir = ws(null);
  try {
    assert.equal(enforceSpawnPersona({ toolName: "edit", params: {} }, {}, { cwd: dir }), undefined);
    assert.equal(enforceSpawnPersona({ toolName: "sessions_spawn", params: { message: "<!-- gsd-oc:persona --> already" } }, {}, { cwd: dir }), undefined, "idempotent — no double-inject");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
