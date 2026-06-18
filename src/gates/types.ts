import type { MessagePresentation } from "openclaw/plugin-sdk/interactive-runtime";

/**
 * GsdGate data model + portable presentation re-export (GATE-01..04).
 *
 * A GSD gate is a channel-agnostic decision request. The builders (build-buttons/build-select/
 * build-poll/build-modal) turn a GsdGate into a portable `MessagePresentation` (or `PollInput`),
 * which rides the reply/presentation path; the live Discord render is gateway-gated → Phase 7
 * (D-06). `MessagePresentation` is the SDK's portable presentation type
 * (payload-BHJeg3MX.d.ts:112-116, re-exported by openclaw/plugin-sdk/interactive-runtime).
 */

export type { MessagePresentation };

export type GsdChoiceStyle = "primary" | "secondary" | "success" | "danger";

export type GsdChoice = {
  id: string;
  label: string;
  style?: GsdChoiceStyle;
};

export type GsdGateKind = "binary" | "select" | "poll" | "free-text";

export type GsdGate = {
  id: string;
  kind: GsdGateKind;
  title: string;
  choices?: GsdChoice[];
  /** When true, multiple choices may be picked — routed to a poll (portable select is single-only). */
  multi?: boolean;
  placeholder?: string;
  prompt?: string;
};
