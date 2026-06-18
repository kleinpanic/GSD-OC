import { buildAgentMainSessionKey } from "openclaw/plugin-sdk/routing";

/**
 * Minimal structural view of the subagent runtime surface we use
 * (types-Tcpca_5M.d.ts:6364-6400). Declared locally so this module type-checks against
 * the installed SDK without depending on internal symbol paths.
 */
export type SubagentRuntime = {
  run: (params: {
    sessionKey: string;
    message: string;
    provider?: string;
    model?: string;
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
};

/**
 * Defensively extract the last assistant text from `getSessionMessages().messages`
 * (typed `unknown[]`, OR-3). We do NOT hand-roll a session format — we inspect common
 * message shapes ({ role, content }) and fall back to "".
 */
function extractAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && typeof m === "object" && (m as { role?: unknown }).role === "assistant") {
      const content = (m as { content?: unknown }).content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const parts = content
          .map((c) =>
            c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
              ? (c as { text: string }).text
              : "",
          )
          .filter(Boolean);
        if (parts.length) return parts.join("\n");
      }
    }
  }
  return "";
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
  opts: { timeoutMs?: number; cleanup?: boolean } = {},
): Promise<RunSubagentResult> {
  const sessionKey = buildAgentMainSessionKey({ agentId });
  const { runId } = await api.runtime.subagent.run({ sessionKey, message, deliver: false });
  const wait = await api.runtime.subagent.waitForRun({
    runId,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });

  let text = "";
  if (wait.status === "ok") {
    const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey, limit: 20 });
    text = extractAssistantText(messages);
  }

  if (opts.cleanup !== false) {
    try {
      await api.runtime.subagent.deleteSession({ sessionKey });
    } catch {
      /* cleanup is best-effort; never fail the dispatch on cleanup */
    }
  }

  return { status: wait.status, text, error: wait.error, sessionKey };
}
