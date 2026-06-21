/**
 * Checkpoint / decision-gate engine (native port of GSD's checkpoint protocol). GSD halts at three kinds of
 * human gate: DECISION (pick an option), HUMAN-VERIFY (confirm something passed), HUMAN-ACTION (the human must
 * DO something, then confirm). In Claude Code these were AskUserQuestion modals; in OpenClaw they render as
 * Discord interactive components when `discord_gates` is on, and degrade to a plain-text question otherwise — so
 * the lifecycle still halts-and-asks for users without Discord. This module BUILDS the gate + PARSES the reply;
 * the agent surfaces it (Discord `reply`/poll or text) and feeds the human's answer back to `parseCheckpointReply`.
 */

export type CheckpointType = "decision" | "human-verify" | "human-action";

export interface GateOption {
  id: string;
  label: string;
}

export interface GateRequest {
  type: CheckpointType;
  prompt: string;
  options: GateOption[];
  /** how the agent should surface it: "discord" (interactive components) or "text" (plain question). */
  surface: "discord" | "text";
  /** the human-readable render (the text fallback, or the Discord message body). */
  render: string;
}

const DEFAULTS: Record<CheckpointType, GateOption[]> = {
  decision: [], // caller supplies the choices
  "human-verify": [
    { id: "pass", label: "✅ Verified — passed" },
    { id: "fail", label: "❌ Failed — needs work" },
  ],
  "human-action": [
    { id: "done", label: "✅ Done" },
    { id: "skip", label: "⏭️ Skip" },
  ],
};

/** Build a checkpoint gate. `options` is required for "decision"; the others default to pass/fail or done/skip. */
export function buildCheckpoint(
  type: CheckpointType,
  prompt: string,
  opts: { options?: GateOption[]; discord?: boolean } = {},
): GateRequest {
  // BL-S1: `type` reaches here from a too-loose tool schema (Type.String) — an unknown value (e.g. "approve")
  // has no DEFAULTS entry, so `.map` on undefined would crash. Reject it with a clear, caught error instead.
  if (!(type in DEFAULTS)) throw new Error(`unknown checkpoint type: ${JSON.stringify(type)} (use decision | human-verify | human-action)`);
  const options = (opts.options && opts.options.length ? opts.options : DEFAULTS[type]).map((o) => ({
    id: String(o.id).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32) || "opt",
    label: o.label,
  }));
  if (type === "decision" && options.length === 0) throw new Error("decision checkpoint requires options");
  const surface: GateRequest["surface"] = opts.discord ? "discord" : "text";
  return { type, prompt, options, surface, render: renderCheckpointText({ type, prompt, options }) };
}

/** The plain-text rendering (the non-Discord fallback) — a numbered question the human answers by number or label. */
export function renderCheckpointText(gate: Pick<GateRequest, "type" | "prompt" | "options">): string {
  const head =
    gate.type === "human-action"
      ? "⏸️  ACTION REQUIRED"
      : gate.type === "human-verify"
        ? "⏸️  VERIFY"
        : "⏸️  DECISION";
  const lines = gate.options.map((o, i) => `  ${i + 1}. ${o.label}`);
  return `${head}\n\n${gate.prompt}\n\n${lines.join("\n")}\n\nReply with the number or the option name.`;
}

/**
 * Discord render payload for a gate — the message body + an action row of buttons (one per option), the shape an
 * agent passes to the Discord `reply` tool's components. custom_id encodes the gate type + option id so the reply
 * handler (parseCheckpointReply) can route the click. Pure data; the agent does the actual Discord send.
 */
export interface DiscordGate {
  content: string;
  components: { type: 1; components: { type: 2; style: number; label: string; custom_id: string }[] }[];
}

const STYLE: Record<string, number> = { pass: 3, done: 3, fail: 4, skip: 2 }; // success / danger / secondary

export function renderCheckpointDiscord(gate: Pick<GateRequest, "type" | "prompt" | "options">): DiscordGate {
  // Discord allows ≤5 buttons per action row; chunk if a decision has more options.
  const buttons = gate.options.map((o) => ({ type: 2 as const, style: STYLE[o.id] ?? 1, label: o.label.slice(0, 80), custom_id: `gsd:${gate.type}:${o.id}` }));
  const rows: DiscordGate["components"] = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push({ type: 1, components: buttons.slice(i, i + 5) });
  return { content: gate.prompt, components: rows };
}

/** Map a free-text human reply back to an option id (by number, id, or label substring). null = unrecognized. */
export function parseCheckpointReply(gate: Pick<GateRequest, "options">, reply: string): string | null {
  const r = (reply ?? "").trim().toLowerCase();
  if (!r) return null;
  const byNum = /^(\d+)$/.exec(r);
  if (byNum) {
    const idx = parseInt(byNum[1], 10) - 1;
    return gate.options[idx]?.id ?? null;
  }
  const exact = gate.options.find((o) => o.id === r || o.label.toLowerCase() === r);
  if (exact) return exact.id;
  // LOW-02: partial-match on LABEL only — matching a 2-char id as a substring of the reply mis-routes ("no" in "another").
  const partial = gate.options.find((o) => o.label.toLowerCase().includes(r));
  return partial?.id ?? null;
}
