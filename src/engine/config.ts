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
    model_provider: "anthropic", // provider the opus/sonnet/haiku tiers resolve under (configurable; see resolveModel)
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
    graphify: { enabled: false, build_timeout: 300 }, // optional project knowledge graph (external graphify CLI; off by default)
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
      auto_verify: false, // C-2: even in mode:auto, never auto-pass a human-verify gate unless this is explicitly set
      auto_prune_state: false,
      node_repair: true,
      node_repair_budget: 2,
      pattern_mapper: true,
      nyquist_validation: true,
      skip_discuss: false,
      max_discuss_passes: 3,
      subagent_timeout: 300000, // OpenClaw subagent dispatch timeout (ms)
      drift_threshold: 3, // codebase-drift gate: min structural elements that trigger action (#2003)
      drift_action: "warn", // warn | auto-remap — drift gate response
      context_coverage_gate: true, // plan/verify context-coverage gate (default true upstream; skip when false)
      plan_review_convergence: false, // automated plan→review→replan loop (opt-in)
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

/** Public deep-merge of a partial config over a base (same prototype-pollution hardening). For profiles. */
export function mergeGsdConfig(base: GsdConfig, override: Record<string, unknown>): GsdConfig {
  return deepMerge(base, override);
}

/**
 * Read the project's GSD config with defaults applied. Returns `{ config, source }` where source is
 * "file" when `.planning/config.json` was read, "default" when it was absent/unreadable.
 */
export function readGsdConfig(planningDir = ".planning"): { config: GsdConfig; source: "file" | "default"; overrides: Record<string, unknown> } {
  const p = path.join(planningDir, "config.json");
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return { config: defaultGsdConfig(), source: "default", overrides: {} };
  }
  try {
    // `overrides` is the SPARSE parsed file (only the keys the project actually set) — callers that layer a
    // .gsd-profile / surface profile must merge `overrides` LAST (not the defaulted `config`, which would clobber
    // the profile with defaults on every unset key — the Flow-6 bug).
    const parsed: unknown = JSON.parse(raw);
    // #7: a config.json whose root is an ARRAY / scalar / null is malformed. deepMerge already rejects it (returns
    // defaults), but reporting source:"file" + overrides:[array] let the bogus array flow into resolveProfiledConfig
    // (Object.keys([...]).length is truthy). Treat a non-object root as a config ERROR → defaults, empty overrides.
    if (!isObject(parsed)) return { config: defaultGsdConfig(), source: "default", overrides: {} };
    return { config: deepMerge(defaultGsdConfig(), parsed), source: "file", overrides: parsed };
  } catch {
    return { config: defaultGsdConfig(), source: "default", overrides: {} };
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

export interface SetConfigResult {
  ok: boolean;
  key: string;
  value?: unknown;
  error?: string;
}

/** Walk a dotted key path against the default schema. Returns the default value at that path, or {found:false}. */
function defaultAt(segs: string[]): { found: boolean; value: unknown } {
  let cur: unknown = defaultGsdConfig();
  for (const seg of segs) {
    if (!isObject(cur) || !(seg in cur)) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[seg];
  }
  return { found: true, value: cur };
}

/** Coerce a caller-supplied value to the type of the schema default at this key. Throws on an invalid coercion. */
function coerceToDefault(def: unknown, raw: unknown): unknown {
  if (typeof def === "boolean") {
    if (typeof raw === "boolean") return raw;
    const s = String(raw).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return true;
    if (["false", "0", "no", "off"].includes(s)) return false;
    throw new Error(`expected a boolean, got ${JSON.stringify(raw)}`);
  }
  if (typeof def === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) throw new Error(`expected a number, got ${JSON.stringify(raw)}`);
    return n;
  }
  if (Array.isArray(def)) {
    if (Array.isArray(raw)) return raw;
    const s = String(raw).trim();
    return s === "" ? [] : s.split(",").map((x) => x.trim()).filter(Boolean);
  }
  // string OR null-typed default (project_code, base_branch, …) → string, or explicit null
  if (raw === null) return null;
  const s = String(raw);
  return def === null && (s === "null" || s === "") ? null : s;
}

/**
 * CFG-03: set a single config key (dotted path, e.g. "workflow.tdd_mode") in the SPARSE `.planning/config.json`
 * overrides — the /gsd-settings + /gsd-config write surface, reimplemented natively. The key MUST exist in the
 * default schema (typo/pollution guard) and MUST be a leaf scalar/array (no wholesale object replacement). The
 * value is type-coerced to the schema default's type. Only the changed key is persisted (sparse overrides are
 * preserved so a profile/surface still layers correctly). Never overwrites the whole file.
 */
export function setGsdConfigKey(planningDir: string, key: string, value: unknown): SetConfigResult {
  const segs = key.split(".").map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return { ok: false, key, error: "key is required" };
  if (segs.some((s) => DANGEROUS_KEYS.has(s))) return { ok: false, key, error: "key contains a reserved segment" };
  const at = defaultAt(segs);
  if (!at.found) return { ok: false, key, error: `unknown config key (not in the GSD schema)` };
  if (isObject(at.value)) return { ok: false, key, error: `'${key}' is a section, not a leaf — set a nested key like '${key}.<field>'` };

  let coerced: unknown;
  try {
    coerced = coerceToDefault(at.value, value);
  } catch (e) {
    return { ok: false, key, error: e instanceof Error ? e.message : String(e) };
  }

  // Load the existing SPARSE overrides (not the defaulted config) and deep-set the one key.
  const p = path.join(planningDir, "config.json");
  let overrides: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
    if (isObject(parsed)) overrides = parsed;
  } catch {
    /* absent/corrupt → start from empty sparse overrides */
  }
  let cur = overrides;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (!isObject(next)) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = coerced;

  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(overrides, null, 2) + "\n");
  return { ok: true, key, value: coerced };
}
