import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createWorktree, mergeAndRemoveWorktree, removeWorktree, worktreePath, listWorktrees } from "../src/engine/worktree.js";

test("worktree: unsafe names are rejected (traversal/flags/separators)", () => {
  for (const bad of ["..", ".", "-x", "a/b", "a b", "../evil"]) {
    assert.throws(() => worktreePath("/repo", bad), /unsafe worktree name/, `should reject ${bad}`);
  }
  assert.equal(worktreePath("/repo", "plan-01"), "/repo/.gsd-worktrees/plan-01");
});

test("worktree: dryRun emits injection-safe argv (array, -- guards, no shell)", () => {
  const c = createWorktree("/repo", "plan-01", { dryRun: true });
  assert.deepEqual(c.argv[0], ["worktree", "add", "-b", "gsd/plan-01", "--", "/repo/.gsd-worktrees/plan-01", "HEAD"]);
  const m = mergeAndRemoveWorktree("/repo", "plan-01", { dryRun: true });
  assert.deepEqual(m.argv[0], ["merge", "--no-ff", "--no-edit", "gsd/plan-01"]);
  assert.ok(m.argv.some((a) => a[0] === "worktree" && a[1] === "remove"));
  assert.ok(m.argv.some((a) => a[0] === "branch" && a[1] === "-D"));
});

test("worktree: REAL create → commit in isolation → merge back lands the change, worktree removed", () => {
  const repo = mkdtempSync(join(tmpdir(), "gsd-wt-"));
  const g = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  try {
    g(["init", "-q", "-b", "main"]);
    g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]); g(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "base.txt"), "base\n"); g(["add", "base.txt"]); g(["commit", "-qm", "base"]);

    const c = createWorktree(repo, "plan-01");
    assert.ok(c.ok, c.error); assert.ok(existsSync(c.path), "worktree dir created");

    // do isolated work in the worktree + commit there
    writeFileSync(join(c.path, "feature.txt"), "from worktree\n");
    execFileSync("git", ["add", "feature.txt"], { cwd: c.path });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "feat in worktree"], { cwd: c.path });

    // main does NOT have it yet
    assert.ok(!existsSync(join(repo, "feature.txt")), "isolation: change not on main pre-merge");

    const m = mergeAndRemoveWorktree(repo, "plan-01");
    assert.ok(m.ok, m.error);
    assert.ok(existsSync(join(repo, "feature.txt")), "post-merge: change landed on main");
    assert.ok(!existsSync(c.path), "worktree removed after merge");
    // branch deleted
    assert.ok(!g(["branch", "--list", "gsd/plan-01"]).trim(), "isolation branch deleted");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("worktree: removeWorktree aborts isolation without merging", () => {
  const repo = mkdtempSync(join(tmpdir(), "gsd-wt-"));
  const g = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  try {
    g(["init", "-q", "-b", "main"]); g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]);
    writeFileSync(join(repo, "b.txt"), "b\n"); g(["add", "b.txt"]); g(["-c", "commit.gpgsign=false", "commit", "-qm", "b"]);
    const c = createWorktree(repo, "throwaway"); assert.ok(c.ok, c.error);
    const r = removeWorktree(repo, "throwaway"); assert.ok(r.ok, r.error);
    assert.ok(!existsSync(c.path), "worktree removed");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

import { makeSubagentDispatcher } from "../src/orchestrate/execute-path.js";

test("dispatcher worktree=on: an execute step is isolated, the executor's commit is merged back", async () => {
  const repo = mkdtempSync(join(tmpdir(), "gsd-wtd-"));
  const g = (args: string[], cwd = repo) => execFileSync("git", args, { cwd, encoding: "utf8" });
  try {
    g(["init", "-q", "-b", "main"]); g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]);
    writeFileSync(join(repo, "base.txt"), "x\n"); g(["add", "base.txt"]); g(["-c", "commit.gpgsign=false", "commit", "-qm", "base"]);
    // mock api: the executor "follows the directive" — writes+commits a file in the worktree path it's given.
    let injectedMsg = "";
    const api = { runtime: { subagent: {
      async run(p: { message: string }) {
        injectedMsg = p.message;
        const m = /worktree at (\S+)/.exec(p.message);
        if (m) { const wt = m[1]; writeFileSync(join(wt, "exec.txt"), "done\n"); execFileSync("git", ["add", "exec.txt"], { cwd: wt }); execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "work"], { cwd: wt }); }
        return { runId: "r" };
      },
      async waitForRun() { return { status: "ok" as const }; },
      async getSessionMessages() { return { messages: [{ role: "assistant", content: "ok" }] }; },
      async deleteSession() {},
    } } };
    const disp = makeSubagentDispatcher(api as never, "build feature", undefined, { worktree: { repoRoot: repo } });
    const out = await disp({ verb: "execute", skill: "gsd-executor", reason: "do it", gate: false, pos: 40 } as never);
    assert.ok(out.ok, out.output);
    assert.match(injectedMsg, /ISOLATION:.*worktree at/, "executor directed into the worktree");
    assert.ok(existsSync(join(repo, "exec.txt")), "post-merge-gate landed the isolated commit on main");
    assert.ok(!existsSync(join(repo, ".gsd-worktrees", "execute")), "worktree cleaned up");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
