/**
 * Per-agent model tier resolution (STATE-05 / D-06).
 *
 * Reproduces upstream `model-catalog.cjs` getAgentToModelMapForProfile (108-116) natively.
 * The catalog `.cjs`/.json is a READ-ONLY spec (R0.3): we embed a minimal native table here
 * rather than requiring it at runtime. Provider-agnostic (R0.2): tiers are opaque strings
 * (opus/sonnet/haiku/inherit) swappable per provider later — no Anthropic-only assumptions.
 */

/** heavy/standard/light → adaptive model. model-catalog.json adaptiveTierMap. */
export const ADAPTIVE_TIER_MAP: Record<string, string> = {
  heavy: "opus",
  standard: "sonnet",
  light: "haiku",
};

export const VALID_PROFILES = ["quality", "balanced", "budget", "adaptive", "inherit"] as const;
export type Profile = (typeof VALID_PROFILES)[number];

/**
 * Per-agent tier table mirroring model-catalog.json `agents` (the OD2-relevant subset).
 * `quality` = golden. `adaptive` is derived from routingTier via ADAPTIVE_TIER_MAP.
 */
export type AgentCatalogEntry = {
  quality: string;
  balanced: string;
  budget: string;
  routingTier: keyof typeof ADAPTIVE_TIER_MAP;
};

export const AGENT_CATALOG: Record<string, AgentCatalogEntry> = {
  "gsd-planner": { quality: "opus", balanced: "opus", budget: "sonnet", routingTier: "heavy" },
  "gsd-roadmapper": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "heavy" },
  "gsd-executor": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "standard" },
  "gsd-verifier": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-doc-writer": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
};

export type ModelConfig = {
  model_profile?: string;
  model_profile_overrides?: Record<string, string>;
};

/**
 * Resolve the model for an agent under a config profile.
 *
 * Precedence: per-agent override (config.model_profile_overrides[agentId]) wins;
 * else profile "inherit" → "inherit"; else the agent's tier model for the profile
 * (adaptive uses routingTier → ADAPTIVE_TIER_MAP). Unknown profile falls back to
 * "balanced" (model-catalog.cjs:109). Unknown agent (no override) → null.
 */
export function resolveModel(agentId: string, config: ModelConfig = {}): string | null {
  const override = config.model_profile_overrides?.[agentId];
  if (override) return override;

  const requested = config.model_profile;
  const profile: Profile = (VALID_PROFILES as readonly string[]).includes(requested ?? "")
    ? (requested as Profile)
    : "balanced";

  if (profile === "inherit") return "inherit";

  const entry = AGENT_CATALOG[agentId];
  if (!entry) return null;

  if (profile === "adaptive") return ADAPTIVE_TIER_MAP[entry.routingTier];
  // quality | balanced | budget map directly to the per-agent tier columns.
  return entry[profile] ?? entry.balanced;
}
