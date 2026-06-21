/**
 * Cross-AI review (gsd-review --all / plan-review-convergence). The ACP research confirmed OpenClaw is the ACP
 * CLIENT and `api.runtime.subagent.run({ provider?, model? })` is the trusted seam to delegate to a DIFFERENT
 * model/harness — a GLM review is `run({ model: "glm/glm-4.6" })`; codex/opencode are `runtime.type:"acp"` config
 * agents addressed by `agentId`. So cross-AI review = dispatch the same artifact to each configured external
 * reviewer via its model-ref/agentId, then converge (loop until no HIGH concerns).
 *
 * This module is mechanism-only + testable: it takes a `dispatch` that runs one reviewer (so the live wiring in
 * index.ts maps each `review.external` entry to a `run({model})`/`agentId` call), runs them, and aggregates.
 */

/** One external reviewer: a model-ref ("glm/glm-4.6", "claude/...") or an ACP harness agentId ("codex", "opencode"). */
export interface Reviewer {
  id: string;
  /** "glm/glm-4.6" → in-process provider; bare "codex"/"opencode" → ACP harness agentId. */
  modelRef?: string;
}

export interface ReviewFinding {
  reviewer: string;
  severity: "high" | "medium" | "low";
  text: string;
}

export interface ReviewVerdict {
  findings: ReviewFinding[];
  highCount: number;
}

/** Dispatch ONE reviewer over the artifact; returns its findings. Wired in index.ts to runSubagent({model}). */
export type ReviewDispatch = (reviewer: Reviewer, artifact: string) => Promise<ReviewFinding[]>;

/** Map a `review.external` config entry to a Reviewer (model-ref for in-process providers, agentId for ACP). */
export function resolveReviewer(entry: string, models: Record<string, string> = {}): Reviewer {
  // explicit per-cli model ref wins (e.g. { glm: "glm/glm-4.6" }); else a bare entry is an ACP harness agentId.
  const modelRef = models[entry] ?? (entry.includes("/") ? entry : undefined);
  return { id: entry, modelRef };
}

/**
 * Run cross-AI review: dispatch every configured reviewer concurrently, aggregate findings. The CONVERGENCE
 * loop (re-review after fixes until no HIGH) is the caller's loop; one pass is `crossAiReview`.
 */
export async function crossAiReview(
  reviewers: Reviewer[],
  artifact: string,
  dispatch: ReviewDispatch,
): Promise<ReviewVerdict> {
  if (reviewers.length === 0) return { findings: [], highCount: 0 };
  const results = await Promise.allSettled(reviewers.map((r) => dispatch(r, artifact)));
  const findings: ReviewFinding[] = [];
  for (const r of results) if (r.status === "fulfilled") findings.push(...r.value);
  return { findings, highCount: findings.filter((f) => f.severity === "high").length };
}

/**
 * Convergence: re-review until no HIGH concerns remain or maxRounds is hit. `applyFixes` is dispatched between
 * rounds (the code-fixer); returns the final verdict + the round count. Mirrors plan-review-convergence.
 */
export async function convergeReview(
  reviewers: Reviewer[],
  getArtifact: () => string | Promise<string>,
  dispatch: ReviewDispatch,
  applyFixes: (findings: ReviewFinding[]) => Promise<void>,
  opts: { maxRounds?: number } = {},
): Promise<{ verdict: ReviewVerdict; rounds: number; converged: boolean }> {
  const maxRounds = Math.max(1, Math.min(opts.maxRounds ?? 3, 10));
  let verdict: ReviewVerdict = { findings: [], highCount: 0 };
  let round = 0;
  for (; round < maxRounds; round++) {
    verdict = await crossAiReview(reviewers, await getArtifact(), dispatch);
    if (verdict.highCount === 0) return { verdict, rounds: round + 1, converged: true };
    await applyFixes(verdict.findings.filter((f) => f.severity === "high"));
  }
  return { verdict, rounds: round, converged: verdict.highCount === 0 };
}
