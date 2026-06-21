/**
 * Git branching strategy (native port of GSD's branch logic). Resolves the branch name for a phase/milestone/
 * quick task from the config templates + `git.branching_strategy`, and creates it safely (argv arrays, no shell;
 * `--` guards; never touches identity/force-push). Strategy: "none" (work on the current branch), "phase"
 * (a branch per phase), "milestone" (a branch per milestone), "quick" (a throwaway branch per quick task).
 */
import { spawnSync } from "node:child_process";

export interface BranchConfig {
  branching_strategy?: string;
  phase_branch_template?: string;
  milestone_branch_template?: string;
  quick_branch_template?: string;
  base_branch?: string | null;
}

/** Slug → safe branch segment (alnum + dash, no leading dash). */
function slugify(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => slugify(String(vars[k] ?? "")) || k);
}

/** The branch name for a unit of work under the configured strategy, or null when strategy is "none". */
export function branchNameFor(
  cfg: BranchConfig,
  kind: "phase" | "milestone" | "quick",
  vars: { phase?: string; milestone?: string; slug?: string },
): string | null {
  const strat = cfg.branching_strategy ?? "none";
  if (strat === "none") return null;
  // honor only the strategy that matches the kind (a "phase" strategy doesn't branch for a milestone op)
  if (strat !== kind) return null;
  const tpl =
    kind === "phase"
      ? cfg.phase_branch_template ?? "gsd/phase-{phase}-{slug}"
      : kind === "milestone"
        ? cfg.milestone_branch_template ?? "gsd/{milestone}-{slug}"
        : cfg.quick_branch_template ?? "gsd/quick-{slug}";
  return fill(tpl, { phase: vars.phase ?? "", milestone: vars.milestone ?? "", slug: vars.slug ?? "" });
}

export interface BranchResult {
  argv: string[][];
  ok: boolean;
  branch: string | null;
  error?: string;
}

/** Create (or switch to) the branch for a unit of work. No-op (ok, branch:null) when strategy is "none".
 *  `dryRun` returns the argv without running git (test seam). */
export function createWorkBranch(
  repoRoot: string,
  cfg: BranchConfig,
  kind: "phase" | "milestone" | "quick",
  vars: { phase?: string; milestone?: string; slug?: string },
  opts: { dryRun?: boolean } = {},
): BranchResult {
  const branch = branchNameFor(cfg, kind, vars);
  if (!branch) return { argv: [], ok: true, branch: null };
  const argv: string[][] = [];
  const run = (a: string[]): { ok: boolean; err?: string } => {
    argv.push(a);
    if (opts.dryRun) return { ok: true };
    const r = spawnSync("git", a, { cwd: repoRoot, encoding: "utf8" });
    return r.status === 0 ? { ok: true } : { ok: false, err: (r.stderr || r.stdout || "").trim() };
  };
  // if the branch exists, switch; else create from base (or HEAD). `--` guards the ref.
  const exists = !opts.dryRun && spawnSync("git", ["rev-parse", "--verify", "--quiet", branch], { cwd: repoRoot }).status === 0;
  const base = cfg.base_branch || "HEAD";
  // LOW-01: guard base against a "-flag" value; "--" ends option parsing for the create-from-base form.
  const res = exists ? run(["switch", "--", branch]) : run(["switch", "-c", branch, "--", base]);
  return { argv, ok: res.ok, branch, error: res.err };
}
