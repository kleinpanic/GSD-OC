import type { RouteResult } from "../engine/route.js";
import { GATE_ACTIONS, buildSpawnInstruction } from "../loop/decide.js";

/**
 * Cross-turn advance carrier (ORCH-04 carrier + ORCH-02; 4-RESEARCH.md:144-176, 534-545).
 *
 * `enqueueNextTurn` carries the next route() instruction into turn N+1 via the
 * NON-deprecated `api.session.workflow.enqueueNextTurnInjection` facade. The flat
 * `api.enqueueNextTurnInjection` is @deprecated and is never referenced here.
 *
 * `instructionFor` builds bounded instruction text: for a GATE phase it reuses
 * `buildSpawnInstruction` (so the text names the `sessions_spawn` tool + route→agentId,
 * ORCH-02); for a MECHANICAL/terminal phase it emits a bounded "advance to {action}
 * phase {phase}" string. Either way it carries only route() verb+phase+agentId — never
 * raw .planning/ file bodies (V5 prompt-injection mitigation, 4-RESEARCH.md:790,796).
 *
 * inject.ts performs NO fs read and NO route() call — it receives the RouteResult.
 */

/** Structural view of the non-deprecated workflow injection facade (hook-types:287-308). */
export type NextTurnInjectionApi = {
  session: {
    workflow: {
      enqueueNextTurnInjection: (injection: {
        sessionKey: string;
        text: string;
        idempotencyKey?: string;
        placement?: "prepend_context" | "append_context";
        ttlMs?: number;
      }) => Promise<{ enqueued: boolean; id: string; sessionKey: string }>;
    };
  };
};

/** Deterministic dedupe key on phase+action (D-05). */
function idempotencyKeyFor(next: RouteResult): string {
  return `gsd:${next.phase ?? "_"}:${next.action}`;
}

/** Terminal actions carry no next-turn instruction (the lifecycle has stopped). */
const TERMINAL_ACTIONS: ReadonlySet<string> = new Set(["halt", "complete-milestone"]);

/** Build bounded next-turn instruction text for a route() result. */
export function instructionFor(next: RouteResult): string {
  // #5 guard: a terminal action ("halt"/"complete-milestone") is NOT a step to advance to — emit a stop notice,
  // never "[GSD advance] Proceed to the halt step" (self-contradicting). The live caller never reaches here for a
  // terminal action, but instructionFor is exported, so guard it so a future/test caller can't inject nonsense.
  if (TERMINAL_ACTIONS.has(next.action)) {
    return next.action === "complete-milestone"
      ? "[GSD] The milestone is complete — no further lifecycle step. Run completion/ship if not already done."
      : `[GSD] Halted${next.reason ? ` (${next.reason})` : ""} — resolve the blocker before continuing.`;
  }
  if (GATE_ACTIONS.has(next.action)) {
    return buildSpawnInstruction(agentForGate(next.action), next.phase);
  }
  const phasePart = next.phase ? ` phase ${next.phase}` : "";
  return `[GSD advance] Proceed to the ${next.action}${phasePart} step of the GSD lifecycle.`;
}

/** route→agentId for the two gate verbs (mirrors decide.ts ACTION_AGENT for gates). */
function agentForGate(action: string): string {
  return action === "verify-work" ? "gsd-verifier" : "gsd-planner";
}

/**
 * Enqueue the next route() instruction for turn N+1 via the non-deprecated workflow
 * facade with a deterministic dedupe idempotencyKey. Returns the enqueue result.
 */
export function enqueueNextTurn(
  api: NextTurnInjectionApi,
  sessionKey: string,
  next: RouteResult,
): Promise<{ enqueued: boolean; id: string; sessionKey: string }> {
  return api.session.workflow.enqueueNextTurnInjection({
    sessionKey,
    text: instructionFor(next),
    idempotencyKey: idempotencyKeyFor(next),
    placement: "prepend_context",
  });
}
