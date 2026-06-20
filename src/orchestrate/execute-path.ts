/**
 * PATH execution (codex F3: enforced dispatch, not advisory text). Drives an ordered finite path
 * (from selectPath) step by step: dispatch each step's GSD skill/subagent, HALT at decision gates for
 * the required discussion/approval (ENF-01), and HALT on a failed step. The dispatcher is injected so
 * this is unit-testable with a mock and wires to the live runSubagent in the OpenClaw agent context.
 */
import type { PathStep } from "./select-path.js";

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
