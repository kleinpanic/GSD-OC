import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { enforceToolGate } from "../src/hooks/enforce-gate.js";
import { scratchDir } from "./helpers/scratch.js";

const fxRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures");
const edit = { toolName: "edit", params: { file: "x.ts" } };

/** Build a project scratch dir (carries .git marker) with a given .planning fixture copied in. Uses the canonical
 *  scratch helper → os.tmpdir(), never ~/codeWS (enforced by test/no-workspace-pollution.test.ts). */
function ws(planningFixture: string | null) {
  const dir = scratchDir("enf");
  mkdirSync(join(dir, ".git"), { recursive: true });
  if (planningFixture) {
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
  const dir = scratchDir("noenf"); // no markers (canonical scratch)
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
  const dir = ws("route-no-context"); // coding workspace (has .git), greenfield is fine — spawn enforcement is independent of route
  try {
    const r = enforceSpawnPersona({ toolName: "sessions_spawn", params: { agentId: "dev", message: "plan the auth phase" } }, {}, { cwd: dir });
    assert.ok(r && r.params, "spawn params rewritten");
    const msg = String((r!.params as { message: string }).message);
    assert.match(msg, /GSD \*\*gsd-planner\*\* subagent/, "planner persona injected for a planning task");
    assert.match(msg, /--- Task ---\nplan the auth phase/, "original task preserved after the persona");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF-SPAWN: a debug task routes to the gsd-debugger persona; default is gsd-executor", () => {
  const dir = ws("route-no-context");
  try {
    const dbg = enforceSpawnPersona({ toolName: "sessions_spawn", params: { message: "the build is flaky, debug it" } }, {}, { cwd: dir });
    assert.match(String((dbg!.params as { message: string }).message), /gsd-debugger/);
    const def = enforceSpawnPersona({ toolName: "sessions_spawn", params: { message: "do the thing" } }, {}, { cwd: dir });
    assert.match(String((def!.params as { message: string }).message), /gsd-executor/, "no clear role → still a GSD persona, never bare");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF-SPAWN: non-spawn tool + already-GSD spawn + non-coding ws are left alone", () => {
  const dir = ws("route-no-context");
  try {
    assert.equal(enforceSpawnPersona({ toolName: "edit", params: {} }, {}, { cwd: dir }), undefined);
    assert.equal(enforceSpawnPersona({ toolName: "sessions_spawn", params: { message: "<!-- gsd-oc:persona --> already" } }, {}, { cwd: dir }), undefined, "idempotent — no double-inject");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF: a FAILED verification BLOCKS edits (verifier-caught dead branch fixed)", () => {
  const dir = ws("route-verif-fail");
  try {
    const r = enforceToolGate(edit, {}, { cwd: dir });
    assert.ok(r && r.block === true, "verification-fail must block edits");
    assert.match(r!.blockReason!, /verification is FAILED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF: enforcement scopes to the EDITED FILE's project, not process.cwd()", () => {
  // A GSD project at `dir` (route says discuss/plan). An edit to a file INSIDE it is gated even when
  // process.cwd() is elsewhere — proves the file-path scoping fix (the live process.cwd()=~ bug).
  const dir = ws("route-no-context");
  try {
    const r = enforceToolGate({ toolName: "write", params: { file_path: join(dir, "src", "x.ts") } }, {}, { cwd: "/tmp" });
    assert.ok(r && r.block === true, "edit inside the GSD project is gated regardless of cwd");
    // an edit to a file OUTSIDE any GSD project is allowed
    assert.equal(enforceToolGate({ toolName: "write", params: { file_path: "/tmp/elsewhere/y.ts" } }, {}, { cwd: "/tmp" }), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ENF-SPAWN: persona written back into the SAME key (prompt-keyed spawn — trap fixed)", () => {
  const dir = ws("route-no-context");
  try {
    const r = enforceSpawnPersona({ toolName: "sessions_spawn", params: { prompt: "plan the work" } }, {}, { cwd: dir });
    const p = r!.params as { prompt?: string; message?: string };
    assert.match(String(p.prompt), /gsd-planner/, "persona injected into the prompt key it came from");
    assert.equal(p.message, undefined, "no spurious message key");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { targetPathOf, gsdProjectRoot } from "../src/hooks/enforce-gate.js";

test("CR-3: a non-string derivedPaths element does not crash the gate (returns undefined)", () => {
  assert.equal(targetPathOf({ toolName: "edit", derivedPaths: [123 as unknown as string] }), undefined);
  assert.equal(targetPathOf({ toolName: "edit", params: { path: ["/a"] as unknown as string } }), undefined);
  // and the gate as a whole must not throw on such an event
  assert.doesNotThrow(() => enforceToolGate({ toolName: "edit", derivedPaths: [123 as unknown as string] }, {}, { cwd: "/tmp" }));
});

test("LOW-1: a FILE named .planning does not anchor a project root", () => {
  const dir = scratchDir("fileplan");
  try {
    writeFileSync(join(dir, ".planning"), "i am a file");
    assert.equal(gsdProjectRoot(dir), undefined, ".planning file is not a project root");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FALSE-ALLOW fix: a whitespace-padded mutating tool name is still gated (not bypassed)", () => {
  const d = scratchDir("gatews");
  const p = join(d, ".planning"); mkdirSync(join(p, "phases"), { recursive: true });
  try {
    writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: X\n**Goal:** g\n"); // pre-plan → discuss
    writeFileSync(join(p, "STATE.md"), "---\nstatus: planning\n---\n");
    const f = join(d, "src.ts"); writeFileSync(f, "x");
    for (const tn of ["  edit  ", "\tedit\n", "EDIT", "Write"]) {
      const r = enforceToolGate({ toolName: tn, params: { file_path: f } }, {}, { cwd: d });
      assert.ok(r && r.block, `tool name ${JSON.stringify(tn)} must be gated pre-plan`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});
