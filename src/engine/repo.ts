/**
 * OCT-3 — auto repository creation. On project init, optionally create a GitHub repo (PRIVATE by default) and
 * push the scaffold. Argv-safe (spawnSync arrays, no shell string). FOUR guards (never surprise the user):
 *  1. gh installed   2. gh authenticated   3. an origin already exists → never clobber   4. repo-name collision
 *     on the remote → HALT and ask (don't guess). Privacy invariant: a PUBLIC repo gitignores `.planning` BEFORE
 *     the first push so internal planning never leaks; a PRIVATE repo keeps it. Never deletes/force-pushes/touches
 *     git identity. The command runner is injectable so this is testable without creating real repos.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type RepoMode = "private" | "public" | "off";

export interface CmdResult {
  ok: boolean;
  stdout: string;
  code: number;
}
export type CmdRunner = (cmd: string, args: string[], cwd?: string) => CmdResult;

const realRun: CmdRunner = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), code: r.status ?? -1 };
};

export interface AutoRepoResult {
  created?: string;
  skipped?: string;
  halt?: string;
  needsUser?: boolean;
  visibility?: RepoMode;
  planningStripped?: boolean;
}

/** Ensure `.planning/` is gitignored (for a public repo) before the first push so it can't leak. */
function gitignorePlanning(repoRoot: string): void {
  const gi = path.join(repoRoot, ".gitignore");
  let cur = "";
  try {
    cur = fs.readFileSync(gi, "utf8");
  } catch {
    cur = "";
  }
  if (!/^\.planning\/?\s*$/m.test(cur)) fs.writeFileSync(gi, cur.replace(/\s*$/, "") + "\n.planning/\n");
}

/**
 * Create + push the auto-repo. `name` defaults to the repo dir's basename. Returns a structured result the
 * caller surfaces (created url / skipped+reason / halt+needsUser). Never throws on a guard miss — degrades.
 */
export function createAutoRepo(
  repoRoot: string,
  mode: RepoMode,
  opts: { name?: string; owner?: string; run?: CmdRunner } = {},
): AutoRepoResult {
  if (mode === "off") return { skipped: "auto_repo=off" };
  const run = opts.run ?? realRun;
  const name = opts.name || path.basename(path.resolve(repoRoot));
  // Argv-injection guard: a name/owner like `--upload-pack=…` would smuggle a flag into `gh repo create <slug>`.
  // Require a strict repo-name char class (no leading dash/dot, no separators) before it reaches the CLI.
  const validName = (v: string) => /^[A-Za-z0-9._-]+$/.test(v) && !v.startsWith("-") && !v.startsWith(".");
  if (!validName(name)) return { skipped: `invalid repo name: ${JSON.stringify(name)}`, needsUser: true };
  if (opts.owner && !validName(opts.owner)) return { skipped: `invalid repo owner: ${JSON.stringify(opts.owner)}`, needsUser: true };
  const slug = opts.owner ? `${opts.owner}/${name}` : name;

  // GUARD 1 — gh installed
  if (!run("gh", ["--version"]).ok) return { skipped: "gh not installed", needsUser: true };
  // GUARD 2 — gh authenticated
  if (!run("gh", ["auth", "status"]).ok) return { skipped: "gh not authenticated (run: gh auth login)", needsUser: true };
  // GUARD 3 — an origin already exists → NEVER clobber
  const origin = run("git", ["remote", "get-url", "origin"], repoRoot);
  if (origin.ok && origin.stdout) return { skipped: "origin already configured", created: origin.stdout };
  // GUARD 4 — repo-name collision on the remote → HALT + ask (don't guess reuse/rename)
  if (run("gh", ["repo", "view", slug], repoRoot).ok) return { halt: `repo '${slug}' already exists on the remote — reuse, rename, or set git.auto_repo=off`, needsUser: true };

  // ensure a git repo locally
  if (!run("git", ["rev-parse", "--is-inside-work-tree"], repoRoot).ok) run("git", ["init", "-q"], repoRoot);

  // PRIVACY (BLOCKER C): a public repo must not ship .planning. gitignore alone only blocks UNTRACKED files — in
  // the normal GSD flow .planning was already committed (init → scaffold → gsd_state commit), so it would STILL be
  // pushed. So also untrack it (`git rm -r --cached`, best-effort — ok if it was never tracked) and COMMIT the
  // .gitignore + the removal, so the pushed tree genuinely excludes .planning.
  const planningStripped = mode === "public";
  if (planningStripped) {
    gitignorePlanning(repoRoot);
    run("git", ["rm", "-r", "--cached", "--ignore-unmatch", "--", ".planning"], repoRoot);
    run("git", ["add", "--", ".gitignore"], repoRoot);
    // Commit the staged INDEX as-is (the .planning removal + the .gitignore add) — NO pathspec. A pathspec'd
    // `git commit -- .planning` does a PARTIAL commit that takes the working-tree state of .planning and re-adds
    // it, undoing the `rm --cached`. The plain commit records exactly what's staged.
    run("git", ["commit", "-m", "chore: exclude .planning from the public repo"], repoRoot);
  }

  // CREATE + push (gh creates the remote, sets origin, pushes the current tree)
  const vis = mode === "public" ? "--public" : "--private";
  const create = run("gh", ["repo", "create", slug, vis, "--source=.", "--remote=origin", "--push"], repoRoot);
  if (!create.ok) return { skipped: `gh repo create failed: ${create.stdout}`, needsUser: true, visibility: mode };
  return { created: `https://github.com/${slug}`, visibility: mode, planningStripped };
}
