/**
 * AgentDefinition — the plugin-owned record for a ported GSD agent (D-02, D-05).
 *
 * `prompt` is supplied at dispatch as `SubagentRunParams.extraSystemPrompt`
 * (types-Tcpca_5M.d.ts:6369). `tools` is canonical DATA only: per the 03-01 spike
 * (SPIKE-tool-enforcement.md, Outcome: NOT-ENFORCED-by-subagent.run), `subagent.run`
 * has no tool field, so this allowlist is NOT enforceable on the code-driven dispatch
 * path — it is the source of truth for the Phase-4 `sessions_spawn` /
 * `SessionsSpawnToolsConfig` route (types.tools-CGvqp937.d.ts:306/315/532, deny wins).
 */
export type AgentDefinition = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: { allow: string[]; deny?: string[] };
  thinking: "low" | "high" | "xhigh";
  model?: string;
};

/**
 * CC tool name → OpenClaw tool id (AGT-03 / D-03 / RESEARCH Q4).
 *
 * A `null` value means the token is intentionally DROPPED from the ported allowlist:
 *  - `mcp__*` (handled by prefix in the generator): no MCP-passthrough tool id exists
 *    in the SDK; agents fall back to `exec`-CLI + native web_search/web_fetch (A1).
 *  - `AskUserQuestion`: not a subagent tool — it is a Discord-native human gate
 *    (RESEARCH Q4, "CONFIRMED by absence"; Phase 6 territory), so it carries no
 *    OpenClaw tool id.
 *
 * Unknown tokens (not in this map and not `mcp__*`) MUST fail loud in the generator
 * (no silent drop — Pitfall 2/3).
 */
export const CC_TO_OPENCLAW_TOOL: Record<string, string | null> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  Bash: "exec",
  Grep: "grep",
  Glob: "glob",
  Agent: "sessions_spawn",
  Task: "sessions_spawn",
  WebSearch: "web_search",
  WebFetch: "web_fetch",
  AskUserQuestion: null,
};
