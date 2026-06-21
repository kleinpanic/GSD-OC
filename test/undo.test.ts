import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { undoLast } from "../src/engine/undo.js";

function repo(): string {
  const r = mkdtempSync(join(tmpdir(), "gsd-undo-"));
  const g = (a: string[]) => execFileSync("git", a, { cwd: r, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]); g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]); g(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(r, "a.txt"), "1"); g(["add", "a.txt"]); g(["commit", "-qm", "base"]);
  return r;
}

test("undoLast: reverts a GSD-style HEAD via git revert (never reset)", () => {
  const r = repo();
  try {
    writeFileSync(join(r, "b.txt"), "x"); execFileSync("git", ["add", "b.txt"], { cwd: r });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "feat(x): add b"], { cwd: r });
    const res = undoLast(r);
    assert.ok(res.ok && res.reverted, JSON.stringify(res));
    assert.match(res.argv[0].join(" "), /^revert --no-edit --/, "uses revert, not reset");
    // HEAD is now a revert commit; b.txt gone
    assert.match(execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: r, encoding: "utf8" }), /Revert/);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test("undoLast: SKIPS a non-GSD HEAD (won't silently revert a manual commit)", () => {
  const r = repo();
  try {
    writeFileSync(join(r, "c.txt"), "x"); execFileSync("git", ["add", "c.txt"], { cwd: r });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "wip random stuff"], { cwd: r });
    const res = undoLast(r);
    assert.ok(!res.ok && res.skipped, JSON.stringify(res));
    assert.match(res.skipped!, /not a GSD commit/);
    // force reverts it
    assert.ok(undoLast(r, { force: true }).ok);
  } finally { rmSync(r, { recursive: true, force: true }); }
});

test("undoLast: refuses on a dirty tree; dryRun emits argv without running", () => {
  const r = repo();
  try {
    writeFileSync(join(r, "d.txt"), "x"); execFileSync("git", ["add", "d.txt"], { cwd: r });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "fix: d"], { cwd: r });
    writeFileSync(join(r, "a.txt"), "DIRTY");
    assert.match(undoLast(r).error!, /dirty/);
    // dryRun on a clean tree: returns argv, no actual revert
    execFileSync("git", ["checkout", "a.txt"], { cwd: r });
    const dry = undoLast(r, { dryRun: true });
    assert.ok(dry.ok && dry.reverted);
    assert.match(execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: r, encoding: "utf8" }), /fix: d/, "dryRun did NOT revert");
  } finally { rmSync(r, { recursive: true, force: true }); }
});
