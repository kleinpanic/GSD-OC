/**
 * Agent registry (D-05): resolveAgent + 33/33 inventory over the ported ROSTER.
 *
 * The roster ships inlined in `dist` (roster.generated.ts) — no runtime filesystem
 * read of the source .md files (RESEARCH Q5).
 */
import type { AgentDefinition } from "./types.js";
import { ROSTER } from "./roster.generated.js";

export const AGENTS: Record<string, AgentDefinition> = Object.fromEntries(
  ROSTER.map((a) => [a.id, a]),
);

export const AGENT_IDS: string[] = ROSTER.map((a) => a.id);

// Inventory drift guard (Pitfall 4): the port is exactly the 33 live gsd-*.md agents.
if (AGENT_IDS.length !== 33) {
  throw new Error(`agent roster drift: expected 33 agents, found ${AGENT_IDS.length}`);
}

/** Resolve a ported agent by id; throws on unknown id. */
export function resolveAgent(agentId: string): AgentDefinition {
  const def = AGENTS[agentId];
  if (!def) throw new Error(`unknown agent id: ${agentId}`);
  return def;
}

/** Resolve a ported agent by id, or undefined if unknown (backward-compat dispatch). */
export function resolveAgentOptional(agentId: string): AgentDefinition | undefined {
  return AGENTS[agentId];
}
