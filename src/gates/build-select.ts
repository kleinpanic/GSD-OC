import { encodeGateCallback } from "./resume.js";
import type { GsdGate, MessagePresentation } from "./types.js";

/**
 * GATE-02: large-set single-pick gate → portable MessagePresentation single-select block
 * (payload-BHJeg3MX.d.ts:105-109).
 *
 * The portable select has NO min/max — it is single-only (6-RESEARCH.md:189-192, Pitfall 3
 * :500-504). Multi-pick gates MUST go through buildPollSpec; calling buildSelectGate on a
 * multi-pick gate throws so a silently-broken multi-select cannot ship (T-06-04).
 */
export class MultiPickNotSupportedError extends Error {
  constructor() {
    super("multi-pick gates must use buildPollSpec (portable select is single-only)");
    this.name = "MultiPickNotSupportedError";
  }
}

export function buildSelectGate(gate: GsdGate): MessagePresentation {
  if (gate.multi === true) {
    throw new MultiPickNotSupportedError();
  }
  const choices = gate.choices ?? [];
  return {
    title: gate.title,
    tone: "info",
    blocks: [
      {
        type: "select",
        ...(gate.placeholder ? { placeholder: gate.placeholder } : {}),
        options: choices.map((c) => ({
          label: c.label,
          action: { type: "callback" as const, value: encodeGateCallback(gate.id, c.id) },
        })),
      },
    ],
  };
}
