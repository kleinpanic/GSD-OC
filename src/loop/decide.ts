import type { RouteResult } from "../engine/route.js";

/**
 * The loop's pure brain (ORCH-05/02/03).
 *
 * `decideDispatch` maps a `route()` result to a dispatch MODE with NO live host: no fs
 * reads, no api calls, deterministic. Gate phases (human-driven: discuss, verify) become
 * an AGENT-DRIVEN decision carrying a `sessions_spawn` instruction string the host agent
 * executes; mechanical phases (research, execute, resume) become a CODE-DRIVEN decision
 * with fan-out lanes the plugin runs via runSubagent. halt / complete-milestone are
 * terminal (no dispatch).
 *
 * The live-gateway proof (a real `sessions_spawn` round-trip) is deferred to Phase 7 per
 * the locked decision; this module isolates the provable-now decision logic.
 */

/** Human-gate phases: the agent drives them via sessions_spawn (ORCH-02; 4-RESEARCH.md:648-664). */
export const GATE_ACTIONS: ReadonlySet<string> = new Set(["discuss-phase", "verify-work"]);

/** Mechanical phases: the plugin code-drives fan-out via runSubagent (ORCH-03). */
export const MECHANICAL_ACTIONS: ReadonlySet<string> = new Set([
  "plan-phase",
  "execute-phase",
  "resume-work",
]);

/** route() action → the GSD agent that owns the phase. All ids exist in the 33-agent roster. */
const ACTION_AGENT: Record<string, string> = {
  "discuss-phase": "gsd-planner",
  "verify-work": "gsd-verifier",
  // INTENTIONAL difference from autonomous.ts's ACTION_TO_AGENT (which maps plan-phase → gsd-planner): the
  // gate/finalize path here does RESEARCH-FIRST — plan-phase fans out the researcher across RESEARCH_LANES (ORCH-03,
  // the research-before-plan pattern), then the planner runs in the next step. autonomous.ts dispatches one agent per
  // action so it maps straight to the planner. Both are correct for their context; not an inconsistency to fix.
  "plan-phase": "gsd-project-researcher",
  "execute-phase": "gsd-executor",
  "resume-work": "gsd-executor",
};

/** Number of concurrent lanes per mechanical action (4x research per ORCH-03, else single). */
const FANOUT_WIDTH: Record<string, number> = {
  "plan-phase": 4,
  "execute-phase": 1,
  "resume-work": 1,
};

/** The set of fan-out lane messages for a code-driven decision. */
export type FanoutSpec = {
  /** One bounded instruction string per lane; lane i → messages[i]. */
  messages: string[];
};

/** Discriminated union over `mode`: how the loop should act on a route() result. */
export type DispatchDecision =
  | { mode: "agent-driven"; agentId: string; instruction: string; phase: string | null }
  | { mode: "code-driven"; agentId: string; fanout: FanoutSpec; phase: string | null }
  | { mode: "terminal"; reason: string };

/**
 * Bounded static guidance steering the host agent to call the `sessions_spawn` tool for
 * `agentId` and `sessions_yield` when the gate phase is done. The plugin NEVER calls
 * sessions_spawn/sessions_yield itself — they are model-invoked tools (hard constraint).
 *
 * V5 prompt-injection mitigation (4-RESEARCH.md:790-799): the text carries ONLY the
 * route verb-derived agentId and phase number — never raw .planning/ file bodies.
 */
export function buildSpawnInstruction(agentId: string, phase: string | null): string {
  const phasePart = phase ? ` for phase ${phase}` : "";
  return [
    `[GSD gate] Drive this gate phase${phasePart} by invoking the sessions_spawn tool`,
    `to start the ${agentId} subagent in its own session.`,
    `When the gate phase completes, call sessions_yield to return control to the loop.`,
    `Do not advance past this gate until the human-facing step is satisfied.`,
  ].join(" ");
}

/** Bounded fan-out lane message for a mechanical phase (no raw file bodies, V5). */
function mechanicalLaneMessage(action: string, phase: string | null, lane: number, total: number): string {
  const phasePart = phase ? ` phase ${phase}` : "";
  const lanePart = total > 1 ? ` (lane ${lane + 1}/${total})` : "";
  return `[GSD mechanical] Run ${action}${phasePart}${lanePart}.`;
}

/**
 * Pure mode-selection: route() result → DispatchDecision. No fs, no api, deterministic.
 */
export function decideDispatch(r: RouteResult): DispatchDecision {
  // Terminal: hard-stop gate or milestone completion → no dispatch.
  if (r.route === "halt" || r.action === "halt") {
    return { mode: "terminal", reason: r.reason };
  }
  if (r.action === "complete-milestone") {
    return { mode: "terminal", reason: r.reason };
  }

  // Gate phase → agent-driven (sessions_spawn instruction).
  if (GATE_ACTIONS.has(r.action)) {
    const agentId = ACTION_AGENT[r.action];
    return {
      mode: "agent-driven",
      agentId,
      instruction: buildSpawnInstruction(agentId, r.phase),
      phase: r.phase,
    };
  }

  // Mechanical phase → code-driven fan-out.
  if (MECHANICAL_ACTIONS.has(r.action)) {
    const agentId = ACTION_AGENT[r.action];
    const width = FANOUT_WIDTH[r.action] ?? 1;
    const messages = Array.from({ length: width }, (_, i) =>
      mechanicalLaneMessage(r.action, r.phase, i, width),
    );
    return { mode: "code-driven", agentId, fanout: { messages }, phase: r.phase };
  }

  // Unknown forward action: treat as terminal rather than dispatching blindly.
  return { mode: "terminal", reason: `unhandled-action:${r.action}` };
}
