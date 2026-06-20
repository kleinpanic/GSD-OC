/**
 * PATH execution (codex F3: enforced dispatch, not advisory text). Drives an ordered finite path
 * (from selectPath) step by step: dispatch each step's GSD skill/subagent, HALT at decision gates for
 * the required discussion/approval (ENF-01), and HALT on a failed step. The dispatcher is injected so
 * this is unit-testable with a mock and wires to the live runSubagent in the OpenClaw agent context.
 */
import type { PathStep } from "./select-path.js";
import { runSubagent, type RunSubagentApi } from "../dispatch/run-subagent.js";

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
};

/**
 * A StepDispatcher that drives each step via the live OpenClaw subagent runtime. Steps with a mapped
 * subagent are dispatched (runSubagent); unmapped steps succeed as no-ops so the path advances. The
 * subagent's run status becomes the step outcome (ok/failure).
 */
export function makeSubagentDispatcher(api: RunSubagentApi, intent: string): StepDispatcher {
  return async (step: PathStep): Promise<StepOutcome> => {
    const agentId = VERB_TO_SUBAGENT[step.verb];
    if (!agentId) return { ok: true, output: `${step.verb}: no subagent (skill/gate step)` };
    const msg = `GSD ${step.verb} step for intent: ${intent}. ${step.reason}`;
    const res = await runSubagent(api, agentId, msg);
    return { ok: res.status === "ok", output: res.text || res.status };
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
  reason: "completed" | "gate" | "failure";
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
  const steps: ExecutedStep[] = [];
  for (const step of path) {
    // Decision gate: by default HALT so the discussion/approval happens (ENF-01); autoGates runs through.
    if (step.gate && !opts.autoGates) {
      steps.push({ step, status: "gated" });
      return { steps, completed: false, haltedAt: step.verb, reason: "gate" };
    }
    const outcome = await dispatch(step);
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
