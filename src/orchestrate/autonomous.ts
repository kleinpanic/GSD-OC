/**
 * OCT-W5 — the AUTONOMOUS multi-phase loop. The single-pass drive (executePath) runs one path once; this is
 * the upstream `/gsd-autonomous` semantics: re-read route() after each step and keep driving phase-by-phase
 * until the milestone completes (or a real halt/gate). Each step advances on-disk state (the executor/verifier
 * write artifacts via the OCT-W1 write engine), so route() re-derives the next action from the new state.
 *
 * Critical safety (the audit's infinite-revise risk): a NO-PROGRESS guard — if route() returns the same
 * (action, phase) the previous step just dispatched, the dispatch didn't advance the state, so we BAIL rather
 * than loop forever. The loop is also hard-bounded by maxSteps.
 */
import { route, type RouteResult } from "../engine/route.js";
import { GATE_ACTIONS } from "../loop/decide.js";

export interface AutoStep {
  action: string;
  phase: string | null;
  status: "done" | "failed" | "gated";
  output?: string;
}
export interface AutoResult {
  completed: boolean;
  reason: "complete-milestone" | "gate" | "failure" | "no-progress" | "max-steps" | string;
  steps: AutoStep[];
  haltedAt?: string | null;
}

/** Dispatch one route action; MUST advance on-disk state (write the artifact) for the loop to progress. */
export type AutoDispatch = (r: RouteResult) => Promise<{ ok: boolean; output?: string }>;

/** route() action → the GSD subagent that owns that phase action (route actions differ from path verbs). */
export const ACTION_TO_AGENT: Record<string, string> = {
  "discuss-phase": "gsd-planner",
  "plan-phase": "gsd-planner",
  "execute-phase": "gsd-executor",
  "verify-work": "gsd-verifier",
  "resume-work": "gsd-executor",
};

/** Build an AutoDispatch from a raw subagent-runner. Maps each route action to its subagent + a task message;
 *  actions with no subagent (none today, but defensively) succeed as no-ops so the loop can advance. */
export function makeActionDispatcher(
  run: (agentId: string, message: string) => Promise<{ ok: boolean; output?: string }>,
  intent: string,
): AutoDispatch {
  return async (r) => {
    const agent = ACTION_TO_AGENT[r.action];
    if (!agent) return { ok: true, output: `${r.action}: no subagent` };
    return run(agent, `GSD ${r.action} for phase ${r.phase ?? "?"}. Project intent: ${intent}. Persist the phase artifacts under .planning/.`);
  };
}

export interface AutonomousOptions {
  maxSteps?: number;
  /** auto-pass discuss/verify gates (true = /goal-style autonomous; false = halt at the first gate). */
  autoGates?: boolean;
}

export async function runAutonomous(
  planningDir: string,
  dispatch: AutoDispatch,
  opts: AutonomousOptions = {},
): Promise<AutoResult> {
  const maxSteps = Math.max(1, Math.min(opts.maxSteps ?? 60, 500));
  const autoGates = opts.autoGates !== false;
  const steps: AutoStep[] = [];
  let prevKey = "";

  for (let i = 0; i < maxSteps; i++) {
    const r = route(planningDir);
    const key = `${r.action}:${r.phase ?? ""}`;

    if (r.action === "complete-milestone") return { completed: true, reason: "complete-milestone", steps };
    if (r.action === "halt") return { completed: false, reason: r.reason ?? "halt", steps, haltedAt: r.phase ?? null };

    // A decision gate halts for human approval unless autoGates.
    if (GATE_ACTIONS.has(r.action) && !autoGates) {
      steps.push({ action: r.action, phase: r.phase ?? null, status: "gated" });
      return { completed: false, reason: "gate", steps, haltedAt: r.action };
    }

    // NO-PROGRESS guard: the same action+phase as the previous (successful) step means the dispatch did not
    // advance state — driving it again would loop forever. Bail with the honest reason.
    if (key === prevKey) {
      steps.push({ action: r.action, phase: r.phase ?? null, status: "failed", output: "dispatch did not advance state" });
      return { completed: false, reason: "no-progress", steps, haltedAt: r.action };
    }

    let outcome: { ok: boolean; output?: string };
    try {
      outcome = await dispatch(r);
    } catch (e) {
      steps.push({ action: r.action, phase: r.phase ?? null, status: "failed", output: e instanceof Error ? e.message : String(e) });
      return { completed: false, reason: "failure", steps, haltedAt: r.action };
    }
    steps.push({ action: r.action, phase: r.phase ?? null, status: outcome.ok ? "done" : "failed", output: outcome.output });
    if (!outcome.ok) return { completed: false, reason: "failure", steps, haltedAt: r.action };
    prevKey = key;
  }
  return { completed: false, reason: "max-steps", steps };
}
