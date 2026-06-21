import { join } from "node:path";
import { route, type RouteResult } from "../engine/route.js";
import { decideDispatch } from "../loop/decide.js";
import { instructionFor } from "../orchestrate/inject.js";
import { readGsdConfig } from "../engine/config.js";

/**
 * `before_agent_finalize` auto-advance handler (ORCH-04; 4-RESEARCH.md:89-134, 510-531).
 *
 * On finalize the handler re-runs `route()` and returns `revise` (a same-turn advance) ONLY
 * for a code-driven mechanical step, bounded by two guards (D-06, Pitfall 1 §606-612):
 *   - `event.stopHookActive` ⇒ continue (NEVER revise while a stop hook is active — this is
 *     the loop guard that prevents an infinite revise cycle).
 *   - `retry.maxAttempts = 2` + a deterministic `idempotencyKey` on phase+action dedupe a
 *     repeated revise.
 * Gate phases (discuss/verify), `route:"halt"`, and `complete-milestone` ⇒ continue (do not
 * auto-revise past a human gate or a terminal state).
 *
 * Operator gate: this is a conversation hook — it is INERT unless the operator sets
 * `plugins.entries.gsd-oc.hooks.allowConversationAccess: true` (4-RESEARCH.md:128-134).
 * The plugin NEVER mutates ~/.openclaw/openclaw.json; the gate is documented in the README.
 *
 * NOTE (D-08): setWaiting / managedFlows human-gate pause is DEFERRED to Phase 6 — not built
 * here. The enqueue degrade-path (allowPromptInjection-only) lives in orchestrate/inject.ts.
 */

/** Local event shape (mirror auto-engage.ts local-type pattern; hook-types:478-490). */
export type BeforeAgentFinalizeEvent = {
  sessionId: string;
  sessionKey?: string;
  cwd?: string;
  stopHookActive: boolean;
  lastAssistantMessage?: string;
  messages?: unknown[];
};

/** Local result shape (hook-types:491-504). */
export type BeforeAgentFinalizeResult = {
  action?: "continue" | "revise" | "finalize";
  reason?: string;
  retry?: { instruction: string; idempotencyKey?: string; maxAttempts?: number };
};

/** Local agent-context shape (only the cwd we read). */
export type BeforeAgentFinalizeContext = { cwd?: string };

const MAX_REVISE_ATTEMPTS = 2;

/**
 * Pure finalize decision: event + recomputed route() → continue|revise. No fs/api.
 */
export function decideFinalize(
  event: BeforeAgentFinalizeEvent,
  next: RouteResult,
  opts: { autoGates?: boolean } = {},
): BeforeAgentFinalizeResult {
  // Loop guard (Pitfall 1): never revise while a stop hook is already active.
  if (event.stopHookActive) return { action: "continue" };

  const decision = decideDispatch(next);
  // Terminal (halt / complete-milestone) ALWAYS stops — never auto-advance past a halt or a completed milestone.
  if (decision.mode === "terminal") return { action: "continue" };
  // A human gate (discuss/verify) stops for approval — UNLESS this is a /goal-style autonomous run (mode:auto /
  // workflow.auto_advance): then we drive THROUGH the gate too (the "keep going" re-prompt). stopHookActive +
  // maxAttempts still bound the loop.
  if (decision.mode === "agent-driven" && !opts.autoGates) return { action: "continue" };

  // Mechanical step (or an auto-passed gate) → revise (same-turn advance), bounded + deduped.
  return {
    action: "revise",
    reason: opts.autoGates && decision.mode === "agent-driven" ? "gsd-auto-advance (autonomous gate)" : "gsd-auto-advance",
    retry: {
      instruction: instructionFor(next),
      idempotencyKey: `gsd:${next.phase ?? "_"}:${next.action}`,
      maxAttempts: MAX_REVISE_ATTEMPTS,
    },
  };
}

/**
 * Wired handler: resolve planningDir from ctx.cwd ?? event.cwd, recompute route(), delegate
 * to decideFinalize (cwd-awareness, LIFE-03 pattern).
 */
export function autoAdvanceHandler(
  event: BeforeAgentFinalizeEvent,
  ctx: BeforeAgentFinalizeContext,
): BeforeAgentFinalizeResult {
  const base = ctx?.cwd ?? event.cwd;
  if (!base) return { action: "continue" };
  const planningDir = join(base, ".planning");
  const next = route(planningDir);
  // /goal autonomy: drive through gates only when the project config opts in (mode:auto OR workflow.auto_advance).
  const cfg = readGsdConfig(planningDir).config;
  const autoGates = cfg.mode === "auto" || (cfg.workflow as { auto_advance?: boolean })?.auto_advance === true;
  return decideFinalize(event, next, { autoGates });
}
