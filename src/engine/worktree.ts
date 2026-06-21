/**
 * Git worktree isolation for parallel GSD delegation — the native equivalent of upstream GSD's
 * per-plan-worktree-gate (isolate each parallel plan in its own working tree) + post-merge-gate (merge the
 * isolated branch back, then clean up). Lets the orchestrator drive multiple executors concurrently without
 * their file edits colliding.
 *
 * Reuses commit.ts's safety posture: git is invoked via `spawnSync` with an argv ARRAY (no shell string →
 * no shell-injection), every ref/path passed as a discrete arg, `--` guards where a value could look like a
 * flag, and a `dryRun` seam returns the argv WITHOUT mutating a repo (unit-testable without git).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

export interface WorktreeOptions {
  /** Build argv and return it WITHOUT spawning git (test seam). */
  dryRun?: boolean;
}

export interface GitResult {
  argv: string[][];
  ok: boolean;
  error?: string;
}

/** A worktree name must be a safe path segment — no separators, no leading dash, no traversal. */
function assertSafeName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith("-") || name === "." || name === "..") {
    throw new Error(`unsafe worktree name: ${JSON.stringify(name)}`);
  }
}

function run(repoRoot: string, argv: string[], dryRun: boolean | undefined, acc: string[][]): { ok: boolean; error?: string } {
  acc.push(argv);
  if (dryRun) return { ok: true };
  const r = spawnSync("git", argv, { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || `git ${argv[0]} failed`).trim() };
  return { ok: true };
}

/** The directory under the repo where GSD isolation worktrees live (git-ignored by convention). */
function worktreesDir(repoRoot: string): string {
  return path.join(repoRoot, ".gsd-worktrees");
}

/** Absolute path of the worktree for `name`. */
export function worktreePath(repoRoot: string, name: string): string {
  assertSafeName(name);
  return path.join(worktreesDir(repoRoot), name);
}

/**
 * per-plan-worktree-gate: create an isolated worktree `<repo>/.gsd-worktrees/<name>` on a NEW branch
 * `gsd/<name>` off `base` (default HEAD). Returns the worktree path + branch.
 */
export function createWorktree(
  repoRoot: string,
  name: string,
  opts: WorktreeOptions & { base?: string } = {},
): GitResult & { path: string; branch: string } {
  assertSafeName(name);
  const wt = worktreePath(repoRoot, name);
  const branch = `gsd/${name}`;
  const argv: string[][] = [];
  const base = opts.base ?? "HEAD";
  // `git worktree add -b gsd/<name> <path> <base>` — -b creates the branch; all values are discrete args.
  const res = run(repoRoot, ["worktree", "add", "-b", branch, "--", wt, base], opts.dryRun, argv);
  // Note: `--` before <path> guards a path that could look like a flag; <base> after is a ref, not a flag risk.
  return { argv, ok: res.ok, error: res.error, path: wt, branch };
}

/** Parse `git worktree list --porcelain` into {path, branch} entries. */
export function listWorktrees(repoRoot: string, opts: WorktreeOptions = {}): { argv: string[][]; entries: { path: string; branch?: string }[] } {
  const argv: string[][] = [["worktree", "list", "--porcelain"]];
  if (opts.dryRun) return { argv, entries: [] };
  const r = spawnSync("git", argv[0], { cwd: repoRoot, encoding: "utf8" });
  const entries: { path: string; branch?: string }[] = [];
  let cur: { path: string; branch?: string } | null = null;
  for (const line of (r.stdout || "").split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) entries.push(cur);
      cur = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  if (cur) entries.push(cur);
  return { argv, entries };
}

/**
 * post-merge-gate: merge the worktree's branch `gsd/<name>` back into the current branch of `repoRoot`,
 * then remove the worktree + delete the branch. `--no-ff` keeps the isolation visible in history; a merge
 * CONFLICT is surfaced as ok:false (the caller must resolve, not silently lose work).
 */
export function mergeAndRemoveWorktree(
  repoRoot: string,
  name: string,
  opts: WorktreeOptions & { noFastForward?: boolean } = {},
): GitResult {
  assertSafeName(name);
  const wt = worktreePath(repoRoot, name);
  const branch = `gsd/${name}`;
  const argv: string[][] = [];
  const mergeArgs = ["merge", opts.noFastForward === false ? "--ff" : "--no-ff", "--no-edit", branch];
  const merge = run(repoRoot, mergeArgs, opts.dryRun, argv);
  if (!merge.ok) {
    // CONFLICT: abort so the base tree is left CLEAN (mid-merge state would corrupt the NEXT unit's merge).
    // The unit's work survives on its branch `gsd/<name>` for resolution; only this unit fails.
    run(repoRoot, ["merge", "--abort"], opts.dryRun, argv);
    return { argv, ok: false, error: `merge ${branch} conflicted (work preserved on the branch; tree aborted clean): ${merge.error}` };
  }
  run(repoRoot, ["worktree", "remove", "--force", "--", wt], opts.dryRun, argv);
  run(repoRoot, ["branch", "-D", branch], opts.dryRun, argv);
  return { argv, ok: true };
}

/** Remove an isolation worktree WITHOUT merging (abort path) + delete its branch. */
export function removeWorktree(repoRoot: string, name: string, opts: WorktreeOptions = {}): GitResult {
  assertSafeName(name);
  const wt = worktreePath(repoRoot, name);
  const argv: string[][] = [];
  run(repoRoot, ["worktree", "remove", "--force", "--", wt], opts.dryRun, argv);
  run(repoRoot, ["branch", "-D", `gsd/${name}`], opts.dryRun, argv);
  return { argv, ok: true };
}
