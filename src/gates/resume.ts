import type { NextTurnInjectionApi } from "../orchestrate/inject.js";
import type { GsdGate } from "./types.js";

/**
 * GATE-05 / D-05: gate resume PLUMBING (6-RESEARCH.md Pattern 2, :413-429; setWaiting-avoidance
 * Pitfall 2).
 *
 * The interaction `TContext` is `unknown` at type level (the single uncertain piece of GATE-05,
 * OR-G5a, 6-RESEARCH.md:260-262); `parseGateCallback` is defensive across the three observed
 * shapes. The keyed next-turn injection reuses the non-deprecated workflow facade
 * (NextTurnInjectionApi from src/orchestrate/inject.ts). `managedFlows.setWaiting` is NEVER
 * imported (deprecated — Pitfall 2). The LIVE interaction round-trip is gateway-gated → Phase 7
 * (TEST-02).
 */

export class GateCallbackParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateCallbackParseError";
  }
}

/** SDK PluginInteractiveRegistration shape (structural; types-Tcpca_5M.d.ts:8018-8025). */
export type PluginInteractiveHandlerResult = { handled?: boolean } | void;
export type GateInteractiveRegistration = {
  channel: "discord";
  namespace: "gsd-gate";
  handler: (ctx: unknown) => Promise<PluginInteractiveHandlerResult> | PluginInteractiveHandlerResult;
};

type ParsedCallback = { gateId: string; choice: string };

/** Split "<gateId>:<choice>" on the FIRST colon; throw on missing colon/empty parts. */
function splitCallbackValue(value: string): ParsedCallback {
  const idx = value.indexOf(":");
  if (idx <= 0 || idx >= value.length - 1) {
    throw new GateCallbackParseError(`malformed gate callback value: ${JSON.stringify(value)}`);
  }
  return { gateId: value.slice(0, idx), choice: value.slice(idx + 1) };
}

/**
 * Defensively extract {gateId, choice} from the three observed interaction shapes:
 *   "g1:yes" | {value:"g1:yes"} | {data:{custom_id:"g1:yes"}}.
 * Any other shape (null, {}, non-string value, no colon) throws GateCallbackParseError.
 */
export function parseGateCallback(ctx: unknown): ParsedCallback {
  if (typeof ctx === "string") {
    return splitCallbackValue(ctx);
  }
  if (ctx && typeof ctx === "object") {
    const value = (ctx as { value?: unknown }).value;
    if (typeof value === "string") {
      return splitCallbackValue(value);
    }
    const customId = (ctx as { data?: { custom_id?: unknown } }).data?.custom_id;
    if (typeof customId === "string") {
      return splitCallbackValue(customId);
    }
  }
  throw new GateCallbackParseError("unrecognized gate interaction shape");
}

/** Default-deny validation: gateId must match the pending gate and choice must be a known choice id. */
export function validateGateChoice(pending: GsdGate, gateId: string, choice: string): boolean {
  if (gateId !== pending.id) return false;
  const choices = pending.choices ?? [];
  return choices.some((c) => c.id === choice);
}

/**
 * Bounded resume text — names ONLY the gateId, chosen choice id, and a static resume verb.
 * NEVER raw .planning/ bodies or free interaction text (V5/T-06-08, 6-RESEARCH.md:664).
 */
export function buildGateResumeText(gateId: string, choice: string): string {
  return `[GSD gate resume] Gate ${gateId} resolved with choice ${choice}; resume the paused phase step.`;
}

/** Deterministic dedupe key per gate (replay defense — T-06-06). */
function gateIdempotencyKey(gateId: string): string {
  return `gsd:gate:${gateId}`;
}

/**
 * Build the PluginInteractiveRegistration for the gate resume handler. On a VALID interaction the
 * handler validates → enqueues a keyed next-turn injection via the non-deprecated workflow facade
 * → returns {handled:true}. On an INVALID interaction it returns {handled:false} and does NOT
 * enqueue (default-deny).
 */
export function registerGateInteractiveHandler(opts: {
  api: NextTurnInjectionApi;
  sessionKey: string;
  pending: GsdGate;
}): GateInteractiveRegistration {
  const { api, sessionKey, pending } = opts;
  return {
    channel: "discord",
    namespace: "gsd-gate",
    handler: async (ctx: unknown): Promise<PluginInteractiveHandlerResult> => {
      let parsed: ParsedCallback;
      try {
        parsed = parseGateCallback(ctx);
      } catch {
        return { handled: false };
      }
      if (!validateGateChoice(pending, parsed.gateId, parsed.choice)) {
        return { handled: false };
      }
      await api.session.workflow.enqueueNextTurnInjection({
        sessionKey,
        text: buildGateResumeText(parsed.gateId, parsed.choice),
        idempotencyKey: gateIdempotencyKey(parsed.gateId),
        placement: "prepend_context",
      });
      return { handled: true };
    },
  };
}
