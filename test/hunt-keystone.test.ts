import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../src/engine/route.js";
import { readState } from "../src/state/read-state.js";
import { targetPathOf, enforceSpawnPersona } from "../src/hooks/enforce-gate.js";
import { normalizeInto } from "../src/retrieval/vectors.js";

/** Scratch .planning with a given STATE.md body. */
function scratch(state: string): { dir: string; planning: string } {
  const dir = mkdtempSync(join(tmpdir(), "gsd-keystone-"));
  const planning = join(dir, ".planning");
  mkdirSync(join(planning, "phases", "01-x"), { recursive: true });
  writeFileSync(join(planning, "ROADMAP.md"), "### Phase 1: X\n**Goal:** g\n");
  writeFileSync(join(planning, "STATE.md"), state);
  return { dir, planning };
}

test("BLOCKER: a CRLF STATE.md with status:failed still HALTS (frontmatter fence was \\n-only)", async () => {
  const { dir, planning } = scratch("---\r\nstatus: failed\r\n---\r\n");
  try {
    assert.equal(route(planning).action, "halt", "CRLF failed-state must halt the gate, not be bypassed");
    assert.equal((await readState(planning)).status, "failed", "readState parses CRLF frontmatter");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("targetPathOf finds a path under an UNRECOGNIZED key (no cwd-fallback false-allow)", () => {
  assert.equal(targetPathOf({ toolName: "edit", params: { dest: "src/x.ts" } }), "src/x.ts");
  assert.equal(targetPathOf({ toolName: "edit", params: { uri: "/abs/file.ts" } }), "/abs/file.ts");
  // a non-path string param must NOT be mistaken for the target
  assert.equal(targetPathOf({ toolName: "edit", params: { mode: "overwrite", count: 5 } }), undefined);
  // the known keys still win first
  assert.equal(targetPathOf({ toolName: "edit", params: { file_path: "a.ts", dest: "b.ts" } }), "a.ts");
});

test("enforceSpawnPersona does NOT inject a bogus empty key when the instruction shape is unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-spawn-"));
  const planning = join(dir, ".planning");
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, "STATE.md"), "---\nstatus: planning\n---\n");
  writeFileSync(join(planning, "ROADMAP.md"), "### Phase 1: X\n**Goal:** g\n");
  try {
    // instruction lives in a key the function doesn't know → leave params untouched (no empty `message` clobber)
    const r = enforceSpawnPersona({ toolName: "task", params: { objective: "do the thing" } }, {}, { cwd: dir });
    assert.equal(r, undefined, "unknown instruction shape → no injection (was adding an empty message key)");
    // a known key IS personaed
    const r2 = enforceSpawnPersona({ toolName: "task", params: { task: "research the auth flow" } }, {}, { cwd: dir });
    assert.ok(r2 && typeof (r2.params as { task?: string }).task === "string" && (r2.params as { task: string }).task.includes("GSD"), "known key gets the persona");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BLOCKER: a denormal query vector normalizes to all-zero (the zero-guard must reject it upstream)", () => {
  // documents the hazard isZeroVector now catches via sum-of-squares: a tiny vector underflows to a zero unit vector.
  const tiny = new Array(8).fill(1e-300);
  const out = normalizeInto(tiny);
  assert.ok([...out].every((x) => x === 0), "tiny vector underflows to all-zero after normalize — must be guarded as zero");
});
