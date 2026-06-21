/**
 * Regression gate — compute a metric SNAPSHOT from labeled traces, then compare it to a committed baseline. A
 * metric crossing its bar in the wrong direction (beyond tolerance) is a regression → the gate fails (exit 1 in
 * the CLI). This is what makes improvement PROVABLE and PROTECTED: a PR that improves a metric bumps the baseline
 * (a visible diff); a PR that regresses it fails `npm run bench:gate`.
 */
import type { TaskTrace } from "./types.js";
import { tokensAB, completionRate, falseAllows, tokenRot, overOrchestrated, skillScore } from "./metrics.js";
import { scoreBehavior } from "./rubric.js";
import type { BenchTask } from "./tasks.js";

export interface Snapshot {
  "tokens.trivial.deltaPct": number | null;
  "behavior.score.mean": number;
  "skill.recall.mean": number;
  "enforce.falseAllows": number;
  "rot.redundantReads.max": number;
  "overOrch.rate": number;
  "lifecycle.completion": number;
}

/** Compute the metric snapshot from the A/B traces + the task labels (for expected-subagent recall). */
export function computeSnapshot(traces: TaskTrace[], tasks: BenchTask[]): Snapshot {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const onTraces = traces.filter((t) => t.gsdOn);
  const ab = tokensAB(traces);
  const behaviors = onTraces.map((t) => scoreBehavior(t, byId.get(t.taskId)?.expectSubagents ?? t.firedSubagents).score);
  const recalls = onTraces.map((t) => skillScore(t, byId.get(t.taskId)?.expectSubagents ?? []).recall);
  const rots = onTraces.map((t) => tokenRot(t).redundantReads);
  const trivial = onTraces.filter((t) => t.band === "trivial");
  return {
    "tokens.trivial.deltaPct": ab.trivial?.deltaPct ?? null,
    "behavior.score.mean": mean(behaviors),
    "skill.recall.mean": mean(recalls),
    "enforce.falseAllows": falseAllows(traces),
    "rot.redundantReads.max": rots.length ? Math.max(...rots) : 0,
    "overOrch.rate": trivial.length ? trivial.filter(overOrchestrated).length / trivial.length : 0,
    "lifecycle.completion": completionRate(onTraces),
  };
}

export interface Baseline {
  metrics: Record<string, { value: number | null; bar: "≥" | "≤" | "=="; min?: number; max?: number; eq?: number; tol?: number }>;
}

export interface Regression {
  metric: string;
  baseline: number | null;
  current: number | null;
  bar: string;
}

/** Compare a snapshot to a baseline. Returns the regressions (empty ⇒ pass). */
export function compareToBaseline(snap: Snapshot, baseline: Baseline): { pass: boolean; regressions: Regression[] } {
  const regressions: Regression[] = [];
  for (const [metric, spec] of Object.entries(baseline.metrics)) {
    const current = (snap as unknown as Record<string, number | null>)[metric];
    if (current == null) continue; // unmeasured this run (e.g. no trivial arm) — skip, don't fail
    const tol = spec.tol ?? 0;
    let bad = false;
    if (spec.bar === "≥" && spec.min != null) bad = current < spec.min - tol;
    else if (spec.bar === "≤" && spec.max != null) bad = current > spec.max + tol;
    else if (spec.bar === "==" && spec.eq != null) bad = current !== spec.eq;
    if (bad) regressions.push({ metric, baseline: spec.value, current, bar: spec.bar });
  }
  return { pass: regressions.length === 0, regressions };
}

function mean(ns: number[]): number {
  return ns.length ? Math.round((ns.reduce((a, n) => a + n, 0) / ns.length) * 100) / 100 : 0;
}
