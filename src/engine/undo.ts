/**
 * undo (native port of gsd-undo) — reverse the last GSD action SAFELY. It uses `git revert` (a new inverse
 * commit), NEVER `git reset --hard` or a force-push, so history is preserved and nothing is destroyed. It only
 * reverts a commit that looks like a GSD commit (a conventional `type(scope): …` or `gsd` marker) unless `force`,
 * so a stray manual commit isn't silently undone. Argv arrays, `--` guard, dryRun seam.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface UndoResult {
  argv: string[][];
  ok: boolean;
  reverted?: { sha: string; subject: string };
  skipped?: string;
  error?: string;
}

const GSD_COMMIT = /^(feat|fix|docs|refactor|test|chore|build|ci|perf|style)(\([^)]*\))?:|gsd[:/]/i;

/** Revert HEAD if it's a GSD-style commit. `force` reverts any HEAD; `dryRun` returns the argv without running. */
export function undoLast(repoRoot: string, opts: { force?: boolean; dryRun?: boolean } = {}): UndoResult {
  const argv: string[][] = [];
  const head = spawnSync("git", ["log", "-1", "--pretty=%H%x00%s"], { cwd: repoRoot, encoding: "utf8" });
  if (head.status !== 0) return { argv, ok: false, error: "no commits / not a git repo" };
  const [sha, subject] = (head.stdout ?? "").trim().split("\0");
  if (!sha) return { argv, ok: false, error: "could not read HEAD" };
  if (!opts.force && !GSD_COMMIT.test(subject ?? "")) {
    return { argv, ok: false, skipped: `HEAD is not a GSD commit ("${subject}") — pass force to revert anyway` };
  }
  // a clean tree is required (revert refuses on a dirty tree) — surface it instead of half-doing it
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  if (!opts.dryRun && (dirty.stdout ?? "").trim()) return { argv, ok: false, error: "working tree is dirty — commit/stash first" };

  const a = ["revert", "--no-edit", "--", sha];
  argv.push(a);
  if (opts.dryRun) return { argv, ok: true, reverted: { sha, subject: subject ?? "" } };
  const r = spawnSync("git", a, { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) {
    // MED-01: only abort when a revert is actually IN PROGRESS (a conflict left REVERT_HEAD); a non-conflict
    // failure (GPG/detached-HEAD) has nothing to abort, and we must not mislabel it as a conflict.
    const inProgress = existsSync(join(repoRoot, ".git", "REVERT_HEAD"));
    if (inProgress) spawnSync("git", ["revert", "--abort"], { cwd: repoRoot });
    return { argv, ok: false, error: `revert ${inProgress ? "conflicted (tree aborted clean)" : "failed"}: ${(r.stderr || r.stdout || "").trim()}` };
  }
  return { argv, ok: true, reverted: { sha, subject: subject ?? "" } };
}
