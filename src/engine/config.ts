/**
 * CFG-01/02: native GSD config (`.planning/config.json`) reader + default schema (parity with the GSD
 * `/gsd-settings` + `/gsd-config` surface, reimplemented natively per R0.3 — no gsd-tools). Exposes the
 * canonical default GSD config so an OpenClaw agent can inspect/bootstrap settings without a Claude CLI.
 */
import fs from "node:fs";
import path from "node:path";

export interface GsdWorkflowConfig {
  research: boolean;
  plan_check: boolean;
  verifier: boolean;
  code_review: boolean;
  security_enforcement: boolean;
  plan_bounce: boolean;
  auto_advance: boolean;
  tdd_mode: boolean;
  discuss_mode: string;
  human_verify_mode: string;
  [k: string]: unknown;
}

export interface GsdConfig {
  model_profile: string;
  commit_docs: boolean;
  parallelization: boolean;
  git: { branching_strategy: string; create_tag: boolean; [k: string]: unknown };
  workflow: GsdWorkflowConfig;
  [k: string]: unknown;
}

/** The canonical default GSD config — mirrors GSD's own defaults (reference:planning-config + settings). */
export function defaultGsdConfig(): GsdConfig {
  return {
    // ── core ──
    mode: "interactive", // interactive | auto — autonomous-vs-gated lifecycle
    model_profile: "balanced",
    model_profile_overrides: {}, // per-agent model overrides (resolveModel honors these)
    effort: { default: "high" }, // OpenClaw model effort tier
    granularity: "standard", // coarse | standard | fine — top-level plan granularity
    phase_naming: "sequential",
    project_code: null, // short project code prefix for REQ-IDs / branches
    commit_docs: true,
    parallelization: true,
    search_gitignored: false,
    resolve_model_ids: false, // Claude-Code model-id resolution — inert in OpenClaw (provider-agnostic)
    context_window: null, // Claude-context accounting — inert in OpenClaw (OpenClaw manages context)
    context: null, // free-form project context hint
    response_language: null, // i18n — inert in OpenClaw unless the host supports it
    agent_skills: {}, // per-agent custom skill toggles (agentId → string[])
    sub_repos: [], // additional sub-repo roots to commit into (commit-to-subrepo parity)
    planning: { search_gitignored: false, granularity: "standard", post_planning_gaps: true },
    git: {
      branching_strategy: "none",
      create_tag: true,
      base_branch: null,
      phase_branch_template: "gsd/phase-{phase}-{slug}",
      milestone_branch_template: "gsd/{milestone}-{slug}",
      quick_branch_template: "gsd/quick-{slug}",
      auto_repo: "private", // OCT-3: default-on PRIVATE GitHub repo at init ("private"|"public"|"off")
      auto_repo_owner: null,
    },
    ship: { pr_body_sections: [] },
    // ── external research providers (encouraged when available; detection at runtime) ──
    brave_search: false,
    firecrawl: false,
    exa_search: false,
    // ── review (cross-AI via ACP run({model})) ──
    review: {
      external: [], // [] or any of: coderabbit | codex | gemini | claude | opencode (ACP harness agentIds)
      cross_ai_plan_review: false,
      models: {}, // optional per-cli model ref, e.g. { glm: "glm/glm-4.6", codex: "codex" }
    },
    // ── features / hooks / learning / intel ──
    features: { global_learning: true, thinking_partner: false },
    hooks: { context_warnings: false }, // default false (always)
    learning: { max_inject: 5 },
    intel: { enabled: false },
    // ── reference / surface / install profiles ──
    profiles: { active: null, surface: "default" }, // reference + surface (skill-surfacing) profiles
    discord_gates: false, // decision gates as Discord interactive components (with non-Discord fallback)
    workflow: {
      research: true,
      research_before_questions: true, // default TRUE (per the user)
      plan_check: true,
      plan_checker: true, // alias
      verifier: true,
      code_review: true,
      code_review_depth: "standard",
      security_enforcement: true,
      security_asvs_level: 1,
      security_block_on: "high",
      plan_bounce: false,
      plan_bounce_passes: 2,
      auto_advance: false,
      auto_prune_state: false,
      node_repair: true,
      node_repair_budget: 2,
      pattern_mapper: true,
      nyquist_validation: true,
      skip_discuss: false,
      max_discuss_passes: 3,
      subagent_timeout: 300000, // OpenClaw subagent dispatch timeout (ms)
      use_worktrees: false, // OCT-5 parallel worktree isolation toggle
      enforce_tool_gate: true, // the before_tool_call edit gate (per-project override)
      inline_plan_threshold: 3, // plans ≤ N → inline (no separate PLAN.md fan-out)
      post_planning_gaps: true, // run the gap-checker after planning
      ui_phase: true,
      ui_safety_gate: true,
      ui_review: false,
      ai_integration_phase: true,
      tdd_mode: false,
      text_mode: false, // Claude-CLI rendering mode — inert in OpenClaw (Discord-native output)
      discuss_mode: "discuss",
      human_verify_mode: "end-of-phase",
    },
    // manager flags (default sub-flags for the /gsd-manager orchestrator)
    manager: { flags: { execute: "", discuss: "", plan: "" } },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keys that would pollute the prototype chain if copied from a parsed JSON config (H-1). */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Deep-merge `override` onto `base` (objects merge, scalars/arrays from override win).
 *  Hardened against prototype pollution + type confusion: dangerous keys are skipped, and a scalar override
 *  for an object-typed default is REJECTED (keeps the default) so a malformed config can't silently flip a
 *  structured field into a wrong-typed scalar. */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) {
    // Type-guard: if the default is an object but the override is a scalar/array, keep the default.
    if (isObject(base) && override !== undefined && !isObject(override)) return base;
    return override === undefined ? base : (override as T);
  }
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(override)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    out[k] = k in out ? deepMerge((base as Record<string, unknown>)[k], override[k]) : override[k];
  }
  return out as T;
}

/**
 * Read the project's GSD config with defaults applied. Returns `{ config, source }` where source is
 * "file" when `.planning/config.json` was read, "default" when it was absent/unreadable.
 */
export function readGsdConfig(planningDir = ".planning"): { config: GsdConfig; source: "file" | "default" } {
  const p = path.join(planningDir, "config.json");
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return { config: defaultGsdConfig(), source: "default" };
  }
  try {
    return { config: deepMerge(defaultGsdConfig(), JSON.parse(raw)), source: "file" };
  } catch {
    return { config: defaultGsdConfig(), source: "default" };
  }
}

/**
 * CFG-02: write a default GSD config if none exists. Returns true if a file was created, false if one was
 * already present (never overwrites a user's config). Idempotent.
 */
export function bootstrapGsdConfig(planningDir = ".planning"): boolean {
  const p = path.join(planningDir, "config.json");
  if (fs.existsSync(p)) return false;
  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(defaultGsdConfig(), null, 2) + "\n");
  return true;
}
