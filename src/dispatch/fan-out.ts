import { buildAgentMainSessionKey } from "openclaw/plugin-sdk/routing";
import { resolveAgentOptional } from "../agents/index.js";
import {
  extractAssistantText,
  type RunSubagentApi,
  type RunSubagentResult,
} from "./run-subagent.js";

/**
 * Concurrent fan-out of one agentId across N lanes (ORCH-03, D-07/OR-Q5a fix).
 *
 * `runSubagent` builds its sessionKey from the agentId ALONE, so N concurrent same-agentId
 * dispatches would collide on a single session and bleed transcripts. Fan-out instead
 * derives a DISTINCT per-lane key via `buildAgentMainSessionKey({ agentId, mainKey:
 * "lane-i" })` (4-RESEARCH.md:701-707) and dispatches each lane against its own session —
 * reusing run-subagent.ts's `extractAssistantText` (re-exported; no private import).
 *
 * Lanes run under `Promise.all` with no concurrency cap (4-RESEARCH.md:322-324) and the
 * results are aggregated in input order (lane i → results[i]). A failed lane carries its
 * status; fan-out never throws on a single-lane failure.
 */

export type FanOutLane = {
  index: number;
  message: string;
  sessionKey: string;
};

async function runLane(
  api: RunSubagentApi,
  agentId: string,
  sessionKey: string,
  message: string,
  timeoutMs: number,
  cleanup: boolean,
): Promise<RunSubagentResult> {
  const def = resolveAgentOptional(agentId);
  const runParams: Parameters<RunSubagentApi["runtime"]["subagent"]["run"]>[0] = {
    sessionKey,
    message,
    deliver: false,
  };
  if (def) {
    runParams.extraSystemPrompt = def.prompt;
    runParams.lane = def.thinking;
  }

  let result: RunSubagentResult;
  try {
    const { runId } = await api.runtime.subagent.run(runParams);
    const wait = await api.runtime.subagent.waitForRun({ runId, timeoutMs });
    let text = "";
    let parsed: boolean | undefined;
    if (wait.status === "ok") {
      const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey, limit: 20 });
      const extracted = extractAssistantText(messages);
      text = extracted.text;
      parsed = extracted.parsed; // L-03: parser-drift vs empty-reply signal
    }
    result = { status: wait.status, text, error: wait.error, sessionKey, parsed };
  } catch (err) {
    // A lane dispatch error must not sink the whole fan-out (no throw, OR-Q5a).
    result = { status: "error", text: "", error: String(err), sessionKey };
  }

  if (cleanup) {
    try {
      await api.runtime.subagent.deleteSession({ sessionKey });
    } catch {
      /* cleanup is best-effort; never fail the dispatch on cleanup */
    }
  }
  return result;
}

export async function fanOutSubagents(
  api: RunSubagentApi,
  agentId: string,
  messages: string[],
  opts: { timeoutMs?: number; cleanup?: boolean } = {},
): Promise<RunSubagentResult[]> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const cleanup = opts.cleanup !== false;
  // Distinct per-lane sessionKey (D-07): same agentId, different mainKey ⇒ no collision.
  const lanes: FanOutLane[] = messages.map((message, index) => ({
    index,
    message,
    sessionKey: buildAgentMainSessionKey({ agentId, mainKey: `lane-${index}` }),
  }));
  return Promise.all(
    lanes.map((lane) => runLane(api, agentId, lane.sessionKey, lane.message, timeoutMs, cleanup)),
  );
}
