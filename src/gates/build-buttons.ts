import { encodeGateCallback } from "./resume.js";
import type { GsdGate, MessagePresentation } from "./types.js";

/**
 * GATE-01: binary/small-N gate → portable MessagePresentation buttons block
 * (6-RESEARCH.md Pattern 1, :399-411; payload-BHJeg3MX.d.ts:8-38,101-104).
 *
 * Each choice becomes a button whose action is a typed callback carrying the value
 * `"<gateId>:<choiceId>"` — produced by the shared `encodeGateCallback` codec and parsed
 * by parseGateCallback (M-04: the codec rejects ':' in either id so builder + parser agree).
 */
export function buildButtonsGate(gate: GsdGate): MessagePresentation {
  const choices = gate.choices ?? [];
  return {
    title: gate.title,
    tone: "info",
    blocks: [
      {
        type: "buttons",
        buttons: choices.map((c) => ({
          label: c.label,
          ...(c.style ? { style: c.style } : {}),
          action: { type: "callback" as const, value: encodeGateCallback(gate.id, c.id) },
        })),
      },
    ],
  };
}
