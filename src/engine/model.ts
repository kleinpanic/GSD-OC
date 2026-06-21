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
 * Per-agent tier table mirroring model-catalog.json `agents` (all 33 agents, faithful to upstream model-catalog.json).
 * `quality` = golden. `adaptive` is derived from routingTier via ADAPTIVE_TIER_MAP.
 */
export type AgentCatalogEntry = {
  quality: string;
  balanced: string;
  budget: string;
  routingTier: keyof typeof ADAPTIVE_TIER_MAP;
};

export const AGENT_CATALOG: Record<string, AgentCatalogEntry> = {
  "gsd-advisor-researcher": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-ai-researcher": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-assumptions-analyzer": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "heavy" },
  "gsd-code-fixer": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "standard" },
  "gsd-code-reviewer": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "standard" },
  "gsd-codebase-mapper": { quality: "sonnet", balanced: "haiku", budget: "haiku", routingTier: "light" },
  "gsd-debug-session-manager": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "heavy" },
  "gsd-debugger": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "heavy" },
  "gsd-doc-classifier": { quality: "sonnet", balanced: "haiku", budget: "haiku", routingTier: "light" },
  "gsd-doc-synthesizer": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-doc-verifier": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-doc-writer": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-domain-researcher": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-eval-auditor": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-eval-planner": { quality: "opus", balanced: "opus", budget: "sonnet", routingTier: "heavy" },
  "gsd-executor": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "standard" },
  "gsd-framework-selector": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "heavy" },
  "gsd-integration-checker": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-intel-updater": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-nyquist-auditor": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-pattern-mapper": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-phase-researcher": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-plan-checker": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-planner": { quality: "opus", balanced: "opus", budget: "sonnet", routingTier: "heavy" },
  "gsd-project-researcher": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-research-synthesizer": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-roadmapper": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "heavy" },
  "gsd-security-auditor": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "heavy" },
  "gsd-ui-auditor": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-ui-checker": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "light" },
  "gsd-ui-researcher": { quality: "opus", balanced: "sonnet", budget: "haiku", routingTier: "standard" },
  "gsd-user-profiler": { quality: "opus", balanced: "sonnet", budget: "sonnet", routingTier: "heavy" },
  "gsd-verifier": { quality: "sonnet", balanced: "sonnet", budget: "haiku", routingTier: "standard" },

};

export type ModelConfig = {
  model_profile?: string;
  model_profile_overrides?: Record<string, string>;
  /** Provider that the bare opus/sonnet/haiku tiers resolve under (default "anthropic" — where those tier names
   *  live). Lets a non-Anthropic setup qualify the tiers, though such users typically use 'inherit' or per-agent refs. */
  model_provider?: string;
};

/**
 * Resolve the model for an agent under a config profile.
 *
 * Precedence: per-agent override (config.model_profile_overrides[agentId]) wins;
 * else profile "inherit" → "inherit"; else the agent's tier model for the profile
 * (adaptive uses routingTier → ADAPTIVE_TIER_MAP). Unknown profile falls back to
 * "balanced" (model-catalog.cjs:109). Unknown agent (no override) → null.
 *
 * M-03: an override is honored only when it is a non-empty, KNOWN tier. An empty
 * string ("") — plausible from a misconfigured overrides map — is treated as ABSENT
 * and falls through to profile resolution (instead of silently returning ""). An
 * unrecognized override tier likewise falls through rather than returning garbage.
 */
const VALID_OVERRIDE_TIERS = new Set<string>(["opus", "sonnet", "haiku", "inherit"]);

/**
 * Qualify a bare tier alias into a fully-resolvable model ref. opus/sonnet/haiku are ANTHROPIC-provider-scoped
 * aliases; OpenClaw's DEFAULT provider is OpenAI, so a bare "opus" resolves to "openai/opus" → fails on a stock
 * gateway (per-agent routing was silently broken by default). Prefixing the provider makes the tier resolve
 * regardless of the gateway default. `model_provider` is configurable (default "anthropic" — that's where these
 * tier names live); a value already carrying a provider ("glm/glm-4.6") is a full ref and passes through.
 */
function qualifyModel(value: string, config: ModelConfig): string {
  if (value.includes("/")) return value; // already a provider/model ref
  const provider = typeof config.model_provider === "string" && config.model_provider ? config.model_provider : "anthropic";
  return `${provider}/${value}`;
}

export function resolveModel(agentId: string, config: ModelConfig = {}): string | null {
  const override = config.model_profile_overrides?.[agentId];
  if (typeof override === "string" && override) {
    // CR-03: "inherit" means LEAVE the parent model — return null. A full provider/model ref passes through (any
    // provider, for non-Anthropic users); a bare tier (opus/sonnet/haiku) is qualified so it actually resolves.
    if (override === "inherit") return null;
    if (override.includes("/")) return override; // explicit provider/model ref — honor as-is
    if (VALID_OVERRIDE_TIERS.has(override)) return qualifyModel(override, config);
    // an unrecognized bare override tier falls through to profile resolution (M-03)
  }

  const requested = config.model_profile;
  const profile: Profile = (VALID_PROFILES as readonly string[]).includes(requested ?? "")
    ? (requested as Profile)
    : "balanced";

  if (profile === "inherit") return null; // CR-03: inherit ⇒ leave the parent model (the cross-provider path)

  const entry = AGENT_CATALOG[agentId];
  if (!entry) return null;

  // quality | balanced | budget map to the per-agent tier columns; adaptive maps via routingTier. Qualify the
  // resulting bare tier with the provider so it resolves on any gateway (default Anthropic, configurable).
  const tier = profile === "adaptive" ? ADAPTIVE_TIER_MAP[entry.routingTier] : entry[profile] ?? entry.balanced;
  return qualifyModel(tier, config);
}
