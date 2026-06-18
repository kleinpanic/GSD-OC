import { spawnSync } from "node:child_process";

/**
 * Safe commit helper (STATE-06 / D-07).
 *
 * Stages each file BY NAME via `git add <file>` (never `-A`, never `.`) then runs
 * `git commit -m <message>` — NEVER `--no-verify` (honors git.md). GPG signing is
 * whatever the user's `~/.config/git/config` dictates: this helper passes no `-S`,
 * `--gpg-sign`, or `--no-gpg-sign` and never overrides identity.
 *
 * This invokes `git` directly (not gsd-tools) — R0.3 forbids shelling gsd-tools/opengsd,
 * not git. spawnSync uses an argv array (no shell string) → no shell-injection sink.
 */

export type CommitOptions = {
  cwd?: string;
  /** When true, build argv and return it WITHOUT spawning git (test seam, no repo mutation). */
  dryRun?: boolean;
};

export type CommitResult = {
  committed: boolean;
  files: string[];
  addArgv: string[];
  commitArgv: string[];
  stdout: string;
  stderr: string;
};

export function commitFiles(
  files: string[],
  message: string,
  opts: CommitOptions = {},
): CommitResult {
  if (files.length === 0) throw new Error("commitFiles: no files to stage");

  // Stage by name: `git add -- <file...>`. The `--` guards against a filename that
  // looks like a flag; the explicit list means no `-A` / `.` ever enters the argv.
  const addArgv = ["add", "--", ...files];
  const commitArgv = ["commit", "-m", message];

  if (opts.dryRun) {
    return { committed: false, files, addArgv, commitArgv, stdout: "", stderr: "" };
  }

  const run = (argv: string[]) =>
    spawnSync("git", argv, { cwd: opts.cwd, encoding: "utf8" });

  const add = run(addArgv);
  if (add.status !== 0) {
    throw new Error(`git add failed (exit ${add.status}): ${add.stderr || add.stdout}`);
  }

  const commit = run(commitArgv);
  if (commit.status !== 0) {
    return {
      committed: false,
      files,
      addArgv,
      commitArgv,
      stdout: commit.stdout ?? "",
      stderr: commit.stderr ?? "",
    };
  }

  return {
    committed: true,
    files,
    addArgv,
    commitArgv,
    stdout: commit.stdout ?? "",
    stderr: commit.stderr ?? "",
  };
}
