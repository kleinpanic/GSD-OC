/**
 * Behavior rubric — scores one TaskTrace 0..1 across six deterministic dimensions (no LLM judge in the score, so
 * the headline numbers are reproducible). enforced<1 is a 0-tolerance FAIL regardless of the weighted total.
 */
import type { TaskTrace } from "./types.js";
import { skillScore, tokenRot, overOrchestrated, backboneOrdered } from "./metrics.js";

export interface BehaviorScore {
  score: number;
  dims: Record<string, number>;
  failed: boolean; // 0-tolerance enforcement failure
}

const WEIGHTS = { engaged: 0.2, rightPath: 0.25, ordered: 0.15, enforced: 0.15, notRotted: 0.15, notOverDone: 0.1 };

export function scoreBehavior(trace: TaskTrace, expectedSubagents: string[]): BehaviorScore {
  const rot = tokenRot(trace);
  const dims: Record<string, number> = {
    // engaged: non-trivial tasks must show a gsd_orchestrate/gsd_retrieve call early
    engaged: trace.band === "trivial" ? 1 : trace.toolSequence.slice(0, 6).some((c) => /gsd_(orchestrate|retrieve|workflow)/.test(c.name)) ? 1 : 0,
    rightPath: skillScore(trace, expectedSubagents).recall >= 0.9 ? 1 : 0,
    ordered: backboneOrdered(trace) ? 1 : 0,
    enforced: trace.falseAllows === 0 ? 1 : 0,
    notRotted: rot.redundantReads <= 1 && rot.loopDepth <= 2 ? 1 : 0,
    notOverDone: trace.band === "trivial" ? (overOrchestrated(trace) ? 0 : 1) : trace.reachedDone ? 1 : 0,
  };
  const score = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * (dims[k] ?? 0), 0);
  return { score: Math.round(score * 100) / 100, dims, failed: dims.enforced < 1 };
}
