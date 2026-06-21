import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  workstreamSlug, createWorkstream, listWorkstreams, activeWorkstream, switchWorkstream,
  completeWorkstream, resolveWorkstreamDir, suggestWorkstream,
} from "../src/engine/workstream.js";

function tmpPlanning(): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-ws-"));
  mkdirSync(join(dir, ".planning"), { recursive: true });
  return join(dir, ".planning");
}

test("workstreamSlug normalizes + rejects empty/traversal", () => {
  assert.equal(workstreamSlug("Auth Feature!"), "auth-feature");
  assert.equal(workstreamSlug("../evil"), "evil");
  assert.throws(() => workstreamSlug("!!!"), /invalid workstream name/);
});

test("create → list → switch → active → resolve", () => {
  const p = tmpPlanning();
  try {
    assert.equal(activeWorkstream(p), null, "none active initially");
    assert.equal(resolveWorkstreamDir(p), p, "no workstreams → root .planning");
    const a = createWorkstream(p, "auth");
    assert.ok(a.created && existsSync(join(a.dir, "STATE.md")) && existsSync(join(a.dir, "phases")));
    assert.equal(activeWorkstream(p), "auth", "first workstream auto-active");
    assert.equal(resolveWorkstreamDir(p), a.dir, "resolve → active track");
    createWorkstream(p, "frontend");
    assert.equal(activeWorkstream(p), "auth", "second does NOT steal active");
    assert.deepEqual(listWorkstreams(p).map((w) => w.name), ["auth", "frontend"]);
    assert.equal(listWorkstreams(p).find((w) => w.name === "auth")!.status, "planning");
    switchWorkstream(p, "frontend");
    assert.equal(activeWorkstream(p), "frontend");
    assert.throws(() => switchWorkstream(p, "nope"), /workstream not found/);
    // idempotent create
    assert.equal(createWorkstream(p, "auth").created, false);
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("complete archives + clears active", () => {
  const p = tmpPlanning();
  try {
    createWorkstream(p, "auth");
    const r = completeWorkstream(p, "auth");
    assert.ok(r.archived);
    assert.ok(existsSync(join(p, "workstreams", ".archive", "auth")), "moved to .archive");
    assert.ok(!existsSync(join(p, "workstreams", "auth")), "removed from active set");
    assert.equal(activeWorkstream(p), null, "active cleared");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("suggestWorkstream: dynamic adoption by intent type + joins existing track", () => {
  assert.equal(suggestWorkstream("add OAuth login flow"), "auth");
  assert.equal(suggestWorkstream("the build is flaky, fix it"), "fixes");
  assert.equal(suggestWorkstream("build the spark embeddings pipeline"), "ai");
  assert.equal(suggestWorkstream("just chatting"), null);
  const p = tmpPlanning();
  try {
    createWorkstream(p, "auth");
    // a new auth-typed intent joins the live 'auth' track
    assert.equal(suggestWorkstream("add a password reset endpoint", p), "auth");
    // an intent naming an existing workstream prefers it
    createWorkstream(p, "payments");
    assert.equal(suggestWorkstream("work on payments integration", p), "payments");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});
