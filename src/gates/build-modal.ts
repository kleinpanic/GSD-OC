import type { GsdGate, MessagePresentation } from "./types.js";

/**
 * GATE-03: free-text gate → portable free-text-fallback MessagePresentation
 * (6-RESEARCH.md:218-236, Pitfall 4 :506-510).
 *
 * NO portable modal type exists. The Discord-native modal rides the @deprecated
 * DiscordComponentMessageSpec.modal facade — this builder does NOT depend on it (T-06-05).
 * The free-text fallback is the durable path; a real Discord modal is a Phase-7 checkpoint
 * (documented in Plan 06-03 / REQUIREMENTS.md). The ModalField/GsdModal types describe the
 * future native modal shape for Phase 7 without binding to the deprecated facade today.
 */

export type ModalField = {
  id: string;
  label: string;
  required?: boolean;
};

export type GsdModal = {
  id: string;
  title: string;
  fields: ModalField[];
};

export function buildFreeTextFallback(gate: GsdGate): MessagePresentation {
  return {
    title: gate.title,
    tone: "info",
    blocks: [
      { type: "text", text: gate.prompt ?? "Reply with your input." },
      {
        type: "context",
        text: "Free-text fallback — a native Discord modal is gateway-gated (Phase 7).",
      },
    ],
  };
}
