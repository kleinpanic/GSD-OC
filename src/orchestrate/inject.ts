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

/** Build bounded next-turn instruction text for a route() result. */
export function instructionFor(next: RouteResult): string {
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
