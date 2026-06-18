import {
  normalizePollInput,
  resolvePollMaxSelections,
  type PollInput,
} from "openclaw/plugin-sdk/poll-runtime";
import type { GsdGate } from "./types.js";

/**
 * GATE-04 / D-04: ranked/multi-pick gate → portable PollInput
 * (polls-CfHkU59X.d.ts:2-16,27; 6-RESEARCH.md:203-216).
 *
 * The multi-pick path: build-select rejects multi-pick gates (portable select is single-only),
 * routing them here. `maxSelections` is resolved by the SDK's `resolvePollMaxSelections`
 * (single-pick → 1; multi → option count); `validatePollSpec` runs the SDK's `normalizePollInput`
 * which clamps maxSelections into range.
 */
export function buildPollSpec(gate: GsdGate): PollInput {
  const choices = gate.choices ?? [];
  return {
    question: gate.title,
    options: choices.map((c) => c.label),
    maxSelections: resolvePollMaxSelections(choices.length, gate.multi),
  };
}

/** Thin wrapper over the SDK's normalizePollInput — clamps maxSelections to option count. */
export function validatePollSpec(spec: PollInput) {
  return normalizePollInput(spec);
}
