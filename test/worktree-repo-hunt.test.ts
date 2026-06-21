import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createWorktree, mergeAndRemoveWorktree } from "../src/engine/worktree.js";
import { createAutoRepo } from "../src/engine/repo.js";
import { scratchDir } from "./helpers/scratch.js";

function gitRepo(): string {
  const repo = scratchDir("wt");
  const g = (a: string[], cwd = repo) => execFileSync("git", a, { cwd, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  g(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "base.txt"), "base\n");
  g(["add", "base.txt"]);
  g(["commit", "-qm", "base"]);
  return repo;
}

test("BLOCKER A: createWorktree reconciles a leaked branch/dir from a prior run (no dead-lock)", () => {
  const repo = gitRepo();
  // simulate a leaked branch `gsd/exec-1` from a prior failed run
  execFileSync("git", ["branch", "gsd/exec-1"], { cwd: repo });
  // a fresh createWorktree on the same name must NOT permanently fail — it reconciles + retries
  const r = createWorktree(repo, "exec-1");
  assert.ok(r.ok, `createWorktree must recover from a leaked branch, got: ${r.error}`);
  assert.ok(existsSync(r.path), "worktree dir created on retry");
});

test("BLOCKER B/E: a clean merge cleans up; the result reflects real cleanup status", () => {
  const repo = gitRepo();
  const c = createWorktree(repo, "u1");
  writeFileSync(join(c.path, "f.txt"), "x");
  execFileSync("git", ["add", "f.txt"], { cwd: c.path });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "u1"], { cwd: c.path });
  const m = mergeAndRemoveWorktree(repo, "u1");
  assert.ok(m.ok, `clean merge should report ok, got: ${m.error}`);
  assert.ok(existsSync(join(repo, "f.txt")), "merged file on main");
  assert.ok(!existsSync(c.path), "worktree dir removed");
  // the branch is gone (no leak that would dead-lock the next same-named run)
  assert.equal(execFileSync("git", ["branch", "--list", "gsd/u1"], { cwd: repo, encoding: "utf8" }).trim(), "");
});

test("BLOCKER C: createAutoRepo (public) untracks + commits away an already-committed .planning", async () => {
  const { mkdirSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const repo = gitRepo();
  // commit .planning (the normal GSD flow) so it's TRACKED before the repo is published public
  mkdirSync(join(repo, ".planning"), { recursive: true });
  writeFileSync(join(repo, ".planning", "PLAN.md"), "secret planning\n");
  execFileSync("git", ["add", ".planning"], { cwd: repo });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "planning"], { cwd: repo });
  // gh is stubbed (no real remote); git runs for real (with gpg disabled) so the untrack+commit actually happens.
  const runner = (cmd: string, args: string[], cwd?: string) => {
    if (cmd === "gh") {
      // pass guards 1-2 (version/auth ok), FAIL guard 4 (repo view → not found, so no collision-halt), allow create
      if (args[0] === "repo" && args[1] === "view") return { ok: false, stdout: "", code: 1 };
      return { ok: true, stdout: "", code: 0 };
    }
    const r = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
    return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), code: r.status ?? -1 };
  };
  createAutoRepo(repo, "public", { name: "pub", run: runner as never });
  const tracked = execFileSync("git", ["ls-files", ".planning"], { cwd: repo, encoding: "utf8" }).trim();
  assert.equal(tracked, "", ".planning must be UNTRACKED in the public repo (privacy invariant)");
});
