/**
 * PATH execution (codex F3: enforced dispatch, not advisory text). Drives an ordered finite path
 * (from selectPath) step by step: dispatch each step's GSD skill/subagent, HALT at decision gates for
 * the required discussion/approval (ENF-01), and HALT on a failed step. The dispatcher is injected so
 * this is unit-testable with a mock and wires to the live runSubagent in the OpenClaw agent context.
 */
import type { PathStep } from "./select-path.js";
import { runSubagent, type RunSubagentApi } from "../dispatch/run-subagent.js";
import { createWorktree, mergeAndRemoveWorktree, removeWorktree } from "../engine/worktree.js";

/**
 * Maps a path verb to the GSD subagent that executes it. Verbs without a subagent (interactive gates
 * like discuss/ship, or skill-only steps like spike/graphify) are absent → driven as a no-op success
 * so the path advances (the gate handling in executePath governs whether they halt).
 */
export const VERB_TO_SUBAGENT: Record<string, string> = {
  "map-codebase": "gsd-codebase-mapper",
  research: "gsd-phase-researcher",
  plan: "gsd-planner",
  execute: "gsd-executor",
  "code-review": "gsd-code-reviewer",
  verify: "gsd-verifier",
  debug: "gsd-debugger",
  secure: "gsd-security-auditor",
  ui: "gsd-ui-researcher",
  "ai-integration": "gsd-eval-planner",
  docs: "gsd-doc-writer",
  integration: "gsd-integration-checker",
};

/**
 * Verbs that intentionally have NO subagent — interactive gates (discuss/ship) or skill-only steps
 * (spike/graphify). A no-op success is correct ONLY for these. Any OTHER unmapped verb is drift (a typo
 * or a renamed verb in selectPath) and must FAIL CLOSED, not silently pass — otherwise a mis-spelled
 * "code-review"→"review" would report success while the enforcement step never ran (CR-01).
 */
export const SKILL_OR_GATE_VERBS = new Set(["discuss", "ship", "spike", "graphify", "complete-milestone"]);

/**
 * A StepDispatcher that drives each step via the live OpenClaw subagent runtime. Steps with a mapped
 * subagent are dispatched (runSubagent); the known skill/gate verbs succeed as no-ops so the path advances
 * (their halting is governed by the static `step.gate` flag in executePath). The subagent's run status
 * becomes the step outcome (ok/failure).
 */
/** Verbs whose subagent writes code — candidates for git-worktree isolation when driving in parallel. */
export const WORKTREE_VERBS = new Set(["execute", "debug"]);

export interface DispatcherOptions {
  /** Isolate file-mutating steps in a git worktree (per-plan-worktree-gate) + merge back (post-merge-gate).
   *  The SDK has no per-run cwd, so the executor is DIRECTED into the worktree and the engine enforces the
   *  merge/cleanup — a conflict surfaces as a failed step, never silent loss. */
  worktree?: { repoRoot: string };
}

export function makeSubagentDispatcher(
  api: RunSubagentApi,
  intent: string,
  baseAgentId?: string,
  opts: DispatcherOptions = {},
): StepDispatcher {
  return async (step: PathStep): Promise<StepOutcome> => {
    const agentId = VERB_TO_SUBAGENT[step.verb];
    if (!agentId) {
      if (!SKILL_OR_GATE_VERBS.has(step.verb)) {
        return { ok: false, output: `unknown verb "${step.verb}" — refusing to no-op (would skip an enforcement step)` };
      }
      return { ok: true, output: `${step.verb}: no subagent (skill/gate step)` };
    }
    let msg = `GSD ${step.verb} step for intent: ${intent}. ${step.reason}`;

    // per-plan-worktree-gate: isolate a code-writing step in its own worktree so parallel executors don't collide.
    const wt = opts.worktree && WORKTREE_VERBS.has(step.verb) ? opts.worktree : null;
    let wtName: string | null = null;
    if (wt) {
      wtName = step.verb; // unique within a path (one step per verb); verbs are safe worktree names
      const created = createWorktree(wt.repoRoot, wtName);
      if (!created.ok) return { ok: false, output: `per-plan-worktree-gate: create failed — ${created.error}` };
      msg += `\n\nISOLATION: make ALL file edits inside the isolated worktree at ${created.path} and commit them there (git add + git commit). Do not modify files outside it — they will be merged back automatically.`;
    }

    // baseAgentId hosts the GSD persona as a sub-lane (allowlist requirement — see runSubagent).
    const res = await runSubagent(api, agentId, msg, baseAgentId ? { baseAgentId } : {});
    const ok = res.status === "ok";

    if (wt && wtName) {
      if (ok) {
        // post-merge-gate: merge the isolated branch back; a conflict fails the step (work is preserved on the branch).
        const merged = mergeAndRemoveWorktree(wt.repoRoot, wtName);
        if (!merged.ok) return { ok: false, output: `post-merge-gate: ${merged.error}` };
      } else {
        removeWorktree(wt.repoRoot, wtName); // abort isolation on a failed/timed-out run
      }
    }
    return { ok, output: res.text || `[${res.status}]` };
  };
}

export interface StepOutcome {
  ok: boolean;
  /** the step paused for an interactive gate (discuss/plan/verify/ui/ai) — caller surfaces it */
  gated?: boolean;
  output?: string;
}

export type StepDispatcher = (step: PathStep) => Promise<StepOutcome>;

export interface ExecutedStep {
  step: PathStep;
  status: "done" | "gated" | "failed";
  output?: string;
}

export interface ExecuteResult {
  steps: ExecutedStep[];
  /** every step ran to completion */
  completed: boolean;
  /** verb of the step we stopped at (gate or failure), or null if completed */
  haltedAt: string | null;
  reason: "completed" | "gate" | "failure" | "empty";
}

export interface ExecutePathOptions {
  /** auto-proceed through decision gates instead of halting (e.g. a `/goal`-style autonomous run) */
  autoGates?: boolean;
}

export async function executePath(
  path: PathStep[],
  dispatch: StepDispatcher,
  opts: ExecutePathOptions = {},
): Promise<ExecuteResult> {
  // WR-03: an empty path ran NOTHING — distinguish it from a path that ran fully. Without this an
  // empty path falls through the loop to a vacuous completed:true, hiding "selectPath found no work".
  if (path.length === 0) return { steps: [], completed: false, haltedAt: null, reason: "empty" };
  const steps: ExecutedStep[] = [];
  for (const step of path) {
    // Decision gate: by default HALT so the discussion/approval happens (ENF-01); autoGates runs through.
    if (step.gate && !opts.autoGates) {
      steps.push({ step, status: "gated" });
      return { steps, completed: false, haltedAt: step.verb, reason: "gate" };
    }
    // A dispatcher that THROWS (SDK/network/abort) becomes a failed step, not an escaped rejection (review LOW-1).
    let outcome: StepOutcome;
    try {
      outcome = await dispatch(step);
    } catch (e) {
      steps.push({ step, status: "failed", output: e instanceof Error ? e.message : String(e) });
      return { steps, completed: false, haltedAt: step.verb, reason: "failure" };
    }
    if (outcome.gated) {
      steps.push({ step, status: "gated", output: outcome.output });
      return { steps, completed: false, haltedAt: step.verb, reason: "gate" };
    }
    if (!outcome.ok) {
      steps.push({ step, status: "failed", output: outcome.output });
      return { steps, completed: false, haltedAt: step.verb, reason: "failure" };
    }
    steps.push({ step, status: "done", output: outcome.output });
  }
  return { steps, completed: true, haltedAt: null, reason: "completed" };
}
