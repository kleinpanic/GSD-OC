import { buildAgentMainSessionKey } from "openclaw/plugin-sdk/routing";
import { resolveAgentOptional } from "../agents/index.js";
import { resolveModel } from "../engine/model.js";
import { readGsdConfig } from "../engine/config.js";
import { gsdProjectRoot } from "../hooks/enforce-gate.js";

/**
 * Minimal structural view of the subagent runtime surface we use
 * (types-Tcpca_5M.d.ts:6364-6374). Declared locally so this module type-checks against
 * the installed SDK without depending on internal symbol paths.
 *
 * `extraSystemPrompt`/`lane` are the per-call persona+effort carriers (:6369-6370).
 * There is intentionally NO `tools` field here: per the 03-01 spike
 * (SPIKE-tool-enforcement.md, Outcome: NOT-ENFORCED-by-subagent.run), SubagentRunParams
 * has no tool argument and the child inherits the parent session tool policy (:1578).
 * Per-agent tool isolation is the Phase-4 sessions_spawn / SessionsSpawnToolsConfig
 * route (types.tools-CGvqp937.d.ts:306/315/532, deny wins) — never claimed here.
 */
export type SubagentRuntime = {
  run: (params: {
    sessionKey: string;
    message: string;
    provider?: string;
    model?: string;
    extraSystemPrompt?: string;
    lane?: string;
    deliver?: boolean;
    idempotencyKey?: string;
  }) => Promise<{ runId: string }>;
  waitForRun: (params: {
    runId: string;
    timeoutMs?: number;
  }) => Promise<{ status: "ok" | "error" | "timeout"; error?: string }>;
  getSessionMessages: (params: {
    sessionKey: string;
    limit?: number;
  }) => Promise<{ messages: unknown[] }>;
  deleteSession: (params: {
    sessionKey: string;
    deleteTranscript?: boolean;
  }) => Promise<void>;
};

export type RunSubagentApi = { runtime: { subagent: SubagentRuntime } };

export type RunSubagentResult = {
  status: "ok" | "error" | "timeout";
  text: string;
  error?: string;
  sessionKey: string;
  /**
   * L-03: distinguishes "no assistant text could be parsed from the transcript"
   * (parsed:false — the loop should treat this as parser drift / unrecognized SDK
   * shape, NOT a genuine empty reply) from "assistant replied but said nothing"
   * (parsed:true, text:""). Only set when status === "ok".
   */
  parsed?: boolean;
};

export type ExtractedAssistantText = {
  /** Concatenated assistant text (may be "" when the agent genuinely said nothing). */
  text: string;
  /**
   * True when a recognizable assistant message WAS found and its content shape
   * was understood (string, or an array of {text}). False when no assistant
   * message matched a known shape — the caller cannot trust `text` as a real reply.
   */
  parsed: boolean;
};

/**
 * Defensively extract the last assistant text from `getSessionMessages().messages`
 * (typed `unknown[]`, OR-3). We do NOT hand-roll a session format — we inspect common
 * message shapes ({ role, content }) and fall back to {text:"", parsed:false}.
 *
 * L-03: returns a parsed flag so callers can tell "no text extracted" (parser drift
 * against the real SDK shape — e.g. a tool-result-only final message, or a
 * {type:"text", value:...} shape) from "agent said nothing" (a real empty reply).
 */
export function extractAssistantText(messages: unknown[]): ExtractedAssistantText {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && typeof m === "object" && (m as { role?: unknown }).role === "assistant") {
      const content = (m as { content?: unknown }).content;
      if (typeof content === "string") return { text: content, parsed: true };
      if (Array.isArray(content)) {
        const textParts = content.filter(
          (c) => c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string",
        );
        // CR-02: an array with NO text parts (tool_use-only or empty array) is NOT a
        // real assistant reply — keep scanning earlier messages so a tool-result-only
        // final message reads as parser drift (parsed:false), per the L-03 contract.
        // Tradeoff: a genuinely empty-array reply now also reads as drift — the safer error.
        if (textParts.length === 0) continue;
        const joined = textParts.map((c) => (c as { text: string }).text).filter(Boolean).join("\n");
        return { text: joined, parsed: true };
      }
      // An assistant message whose content is neither string nor a parts array:
      // unrecognized shape → keep scanning earlier messages, may stay parsed:false.
    }
  }
  return { text: "", parsed: false };
}

/**
 * Code-driven dispatch of ONE GSD subagent by `agentId` (ORCH-01 / AGT-02).
 *
 * D-09 / CRITICAL #4: `subagent.run` takes a `sessionKey`, not an `agentId` — the agent is
 * selected by encoding the id into the session key via `buildAgentMainSessionKey`.
 * This is the code-driven path the plugin uses for mechanical fan-outs (research, execute
 * waves); the agent-driven `sessions_spawn` path is used for human-gate phases.
 */
export async function runSubagent(
  api: RunSubagentApi,
  agentId: string,
  message: string,
  opts: { timeoutMs?: number; cleanup?: boolean; baseAgentId?: string; model?: string; planningDir?: string; sessionSuffix?: string } = {},
): Promise<RunSubagentResult> {
  // GSD subagents (gsd-executor, gsd-planner…) are PERSONAS, not allowlisted OpenClaw agents — spawning a
  // session keyed directly on `gsd-*` fails the host's subagents.allowAgents check ("not in allowlist").
  // When a real base agent is given, run the persona as a SUB-LANE of it (agent:<base>:<gsd-role>) so the
  // session is owned by an allowed agent; the persona is still injected via extraSystemPrompt below.
  //
  // CR-01: CONCURRENT dispatches of the SAME role under the same base (the parallel execute wave's N
  // gsd-executor units, the cross-AI panel's N gsd-code-reviewer calls) would otherwise collide on ONE
  // session key → their transcripts bleed together AND the first finisher's cleanup deletes the live session
  // out from under the others. A `sessionSuffix` (the caller's unique unit/reviewer id) keeps each lane distinct.
  const laneRole = opts.sessionSuffix ? `${agentId}:${opts.sessionSuffix}` : agentId;
  const sessionKey = opts.baseAgentId
    ? buildAgentMainSessionKey({ agentId: opts.baseAgentId, mainKey: laneRole })
    : buildAgentMainSessionKey({ agentId: laneRole });

  // D-04: inject the ported agent's persona per-call via extraSystemPrompt
  // (types-Tcpca_5M.d.ts:6369). Unknown ids degrade to Phase-1 behavior (no persona),
  // never throw — preserving the Phase-1 dispatch contract (T-03-06).
  // @kp-verified: 2026-06-18 — phase 3 — extraSystemPrompt persona injection wired to
  // SubagentRunParams:6369; lane carries effort tier (:6370). def.tools is NOT passed:
  // per 03-01 spike (SPIKE-tool-enforcement.md, NOT-ENFORCED-by-subagent.run) the run
  // path has no tool arg — tool isolation is the Phase-4 sessions_spawn route.
  const def = resolveAgentOptional(agentId);
  const runParams: Parameters<RunSubagentApi["runtime"]["subagent"]["run"]>[0] = {
    sessionKey,
    message,
    deliver: false,
  };
  if (def) {
    runParams.extraSystemPrompt = def.prompt;
    runParams.lane = def.thinking; // effort/lane selector (A2); thinking tier 1:1
  }
  // Per-agent model routing (was dead code — resolveModel had zero callers, so every subagent ran at
  // the parent model regardless of model_profile). Resolve the agent's tier from the GSD config and set
  // it; null (unknown agent / inherit profile) leaves the parent model. opts.model overrides.
  // Resolve the project's .planning (walk up from cwd) so model_profile is read from the ACTUAL project,
  // not cwd-relative ".planning" (gateway home). Same SDK limit as gsd_state — best-effort; honors a
  // project profile when cwd is inside it, else falls back to the default config (HIGH-1).
  const projectRoot = opts.planningDir ? null : gsdProjectRoot(process.cwd()); // one walk, not two (IN-01)
  const planningDir = opts.planningDir ?? (projectRoot ? `${projectRoot}/.planning` : ".planning");
  const model = opts.model ?? resolveModel(agentId, readGsdConfig(planningDir).config);
  if (model) runParams.model = model;
  const { runId } = await api.runtime.subagent.run(runParams);

  // CR-01: the session must be deleted even if waitForRun/getSessionMessages throws
  // after a successful run() — otherwise the session leaks. Cleanup lives in `finally`,
  // not a trailing block.
  try {
    const wait = await api.runtime.subagent.waitForRun({
      runId,
      timeoutMs: opts.timeoutMs ?? 120_000,
    });

    let text = "";
    let parsed: boolean | undefined;
    if (wait.status === "ok") {
      const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey, limit: 20 });
      const extracted = extractAssistantText(messages);
      text = extracted.text;
      // L-03: only meaningful on a successful run — surface parser drift vs empty reply.
      parsed = extracted.parsed;
    }

    return { status: wait.status, text, error: wait.error, sessionKey, parsed };
  } finally {
    if (opts.cleanup !== false) {
      try {
        await api.runtime.subagent.deleteSession({ sessionKey });
      } catch {
        /* cleanup is best-effort; never fail the dispatch on cleanup */
      }
    }
  }
}
