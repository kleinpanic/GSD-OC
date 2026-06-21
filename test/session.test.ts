import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pauseWork, resumeWork, writeThread, listThreads, closeThread, capture } from "../src/engine/session.js";
import { route } from "../src/engine/route.js";

function tmpP(): string {
  const d = mkdtempSync(join(tmpdir(), "gsd-se-"));
  const p = join(d, ".planning"); mkdirSync(join(p, "phases", "01-x"), { recursive: true });
  writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: X\n**Goal:** g\n");
  writeFileSync(join(p, "STATE.md"), "---\nstatus: executing\n---\n# State\n");
  // make phase 1 resumable (a plan, no summary) so route returns a non-halt action when not paused
  writeFileSync(join(p, "phases", "01-x", "01-01-PLAN.md"), "#");
  return p;
}

test("pause→route halts→resume→route advances (the write→read round-trip)", () => {
  const p = tmpP();
  try {
    // before pause: route does NOT halt on checkpoint
    assert.notEqual(route(p).reason, "unresolved-checkpoint");
    const h = pauseWork(p, { reason: "lunch", nextStep: "finish plan 1" }, "2026-06-21T12:00:00Z");
    assert.equal(h.paused_at, "2026-06-21T12:00:00Z");
    assert.ok(existsSync(join(p, "HANDOFF.json")) && existsSync(join(p, ".continue-here.md")));
    assert.match(readFileSync(join(p, "STATE.md"), "utf8"), /paused_at: "2026-06-21T12:00:00Z"/);
    // route now HALTS at the checkpoint
    assert.equal(route(p).reason, "unresolved-checkpoint");
    // resume clears everything + returns the handoff
    const got = resumeWork(p);
    assert.equal(got!.reason, "lunch");
    assert.ok(!existsSync(join(p, "HANDOFF.json")) && !existsSync(join(p, ".continue-here.md")));
    assert.notEqual(route(p).reason, "unresolved-checkpoint", "checkpoint cleared");
    assert.ok(!/^[ \t]*paused_at:[ \t]*\S/m.test(readFileSync(join(p, "STATE.md"), "utf8")), "paused_at cleared (route semantics)");
    assert.equal(resumeWork(p), null, "resume with no pause → null");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("threads: write/append/list/close", () => {
  const p = tmpP();
  try {
    writeThread(p, "Auth Design", "use oauth");
    writeThread(p, "Auth Design", "added pkce");
    assert.deepEqual(listThreads(p), ["auth-design"]);
    assert.match(readFileSync(join(p, "threads", "auth-design.md"), "utf8"), /use oauth[\s\S]*added pkce/);
    assert.ok(closeThread(p, "Auth Design"));
    assert.deepEqual(listThreads(p), []);
    assert.ok(existsSync(join(p, "threads", ".closed", "auth-design.md")));
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("capture appends typed dated items", () => {
  const p = tmpP();
  try {
    assert.ok(capture(p, "add rate limiting", "task"));
    assert.ok(capture(p, "what if we used SSE", "idea"));
    assert.match(readFileSync(join(p, "CAPTURES.md"), "utf8"), /\(task\) add rate limiting[\s\S]*\(idea\) what if/);
    assert.equal(capture(p, "  "), false);
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});
