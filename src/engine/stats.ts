/**
 * Project statistics (native port of the gsd `stats` workflow). A read-only aggregation over `.planning/` + git:
 * phase completion, plan/summary progress, requirement coverage, and git metrics. Composes the existing engines
 * (roadmapPhases / scanUat / gapCheck) rather than re-reading state, plus a bounded git read. Pure read — never
 * mutates. The git read is best-effort (a non-repo / git-less env yields nulls, never throws).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { roadmapPhases } from "./verify.js";
import { scanUat } from "./audit.js";
import { gapCheck } from "./verify.js";

export interface ProjectStats {
  milestone: { version: string | null; name: string | null };
  phases: { total: number; completed: number; percent: number };
  plans: { total: number; summaries: number; percent: number };
  requirements: { total: number; covered: number; percent: number };
  git: { commits: number | null; firstCommitDate: string | null; lastActivity: string | null };
  perPhase: { number: string; name: string; plans: number; summaries: number; verification: string }[];
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/** Count `*-NN-PLAN.md` / `*-NN-SUMMARY.md` files in a phase dir. */
function countPlanFiles(phaseDir: string): { plans: number; summaries: number } {
  let plans = 0,
    summaries = 0;
  try {
    for (const f of fs.readdirSync(phaseDir)) {
      if (/PLAN\.md$/.test(f)) plans++;
      else if (/SUMMARY\.md$/.test(f)) summaries++;
    }
  } catch {
    /* no dir */
  }
  return { plans, summaries };
}

/** Resolve a phase number ("1") to its `phases/NN-slug/` dir. */
function phaseDirFor(planningDir: string, num: string): string | null {
  const phasesDir = path.join(planningDir, "phases");
  try {
    const want = num.padStart(2, "0");
    for (const d of fs.readdirSync(phasesDir, { withFileTypes: true })) {
      if (d.isDirectory() && (d.name.startsWith(`${want}-`) || d.name.startsWith(`${num}-`))) return path.join(phasesDir, d.name);
    }
  } catch {
    /* none */
  }
  return null;
}

/** Best-effort git metrics for the repo containing `planningDir` (the parent). Never throws. */
function gitStats(repoRoot: string): ProjectStats["git"] {
  const git = (args: string[]): string | null => {
    try {
      const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
      return r.status === 0 ? (r.stdout ?? "").trim() : null;
    } catch {
      return null;
    }
  };
  const count = git(["rev-list", "--count", "HEAD"]);
  return {
    commits: count != null && /^\d+$/.test(count) ? Number(count) : null,
    firstCommitDate: git(["log", "--reverse", "--format=%cs", "--max-parents=0"])?.split("\n")[0] ?? null,
    lastActivity: git(["log", "-1", "--format=%cs"]) || null,
  };
}

/** Aggregate project statistics for a `.planning/` dir. */
export function projectStats(planningDir: string): ProjectStats {
  const phases = roadmapPhases(planningDir);
  const uat = new Map(scanUat(planningDir).map((u) => [u.phase, u.verification]));
  let totalPlans = 0,
    totalSummaries = 0,
    completedPhases = 0;
  const perPhase = phases.map((p) => {
    const dir = phaseDirFor(planningDir, p.number);
    const { plans, summaries } = dir ? countPlanFiles(dir) : { plans: 0, summaries: 0 };
    totalPlans += plans;
    totalSummaries += summaries;
    const verification = (uat.get(p.number) as string) ?? "missing";
    if (verification === "passed") completedPhases++;
    return { number: p.number, name: p.name, plans, summaries, verification };
  });

  const gap = gapCheck(planningDir);
  const reqTotal = readReqCount(planningDir);
  const reqCovered = Math.max(0, reqTotal - gap.uncovered.length);

  const state = readState(planningDir);
  return {
    milestone: { version: state.version, name: state.name },
    phases: { total: phases.length, completed: completedPhases, percent: pct(completedPhases, phases.length) },
    plans: { total: totalPlans, summaries: totalSummaries, percent: pct(totalSummaries, totalPlans) },
    requirements: { total: reqTotal, covered: reqCovered, percent: pct(reqCovered, reqTotal) },
    git: gitStats(path.dirname(planningDir)),
    perPhase,
  };
}

/** Count REQ-IDs in REQUIREMENTS.md (the `[A-Z]{2,}-\d+` ids). */
function readReqCount(planningDir: string): number {
  try {
    const req = fs.readFileSync(path.join(planningDir, "REQUIREMENTS.md"), "utf8");
    return new Set([...req.matchAll(/\b[A-Z]{2,}-\d+\b/g)].map((m) => m[0])).size;
  } catch {
    return 0;
  }
}

/** Read the milestone version/name from STATE/ROADMAP (best-effort). */
function readState(planningDir: string): { version: string | null; name: string | null } {
  let version: string | null = null,
    name: string | null = null;
  try {
    const roadmap = fs.readFileSync(path.join(planningDir, "ROADMAP.md"), "utf8");
    name = /^#\s+Roadmap\s*[—-]\s*(.+)$/m.exec(roadmap)?.[1]?.trim() ?? null;
  } catch {
    /* none */
  }
  try {
    const state = fs.readFileSync(path.join(planningDir, "STATE.md"), "utf8");
    version = /^[ \t]*milestone(?:_version)?:[ \t]*"?([\w.-]+)/im.exec(state)?.[1] ?? null;
  } catch {
    /* none */
  }
  return { version, name };
}
