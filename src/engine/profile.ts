/**
 * Profiles (native port of GSD's surface + install profiles). Two kinds:
 *  - SURFACE profile: how much of the GSD surface is active — "minimal" (fast, quick-only), "standard" (the
 *    default lifecycle), "full" (every gate + cross-AI + nyquist). It sets a coherent block of workflow.* flags.
 *  - INSTALL profile (`.gsd-profile` at the repo root): a committed named config preset an operator ships with a
 *    repo so a clone gets the team's GSD settings. It's a partial GsdConfig deep-merged over the defaults.
 * This makes GSD-OC "configurable and versatile" — a team picks a surface + ships a profile, no per-user setup.
 */
import fs from "node:fs";
import path from "node:path";
import type { GsdConfig } from "./config.js";
import { mergeGsdConfig, defaultGsdConfig } from "./config.js";

export type SurfaceProfile = "minimal" | "standard" | "full";

/** Each surface profile is a coherent block of workflow.* + gate settings. */
const SURFACE_PRESETS: Record<SurfaceProfile, Record<string, unknown>> = {
  minimal: {
    workflow: { research: false, plan_check: false, code_review: false, verifier: true, security_enforcement: false, ui_phase: false, ai_integration_phase: false, nyquist_validation: false, skip_discuss: true },
  },
  standard: {
    workflow: { research: true, plan_check: true, code_review: true, verifier: true, security_enforcement: true, nyquist_validation: true, skip_discuss: false },
  },
  full: {
    workflow: { research: true, plan_check: true, code_review: true, verifier: true, security_enforcement: true, security_asvs_level: 2, plan_bounce: true, nyquist_validation: true, ui_phase: true, ui_review: true, ai_integration_phase: true, pattern_mapper: true },
    review: { cross_ai_plan_review: true },
  },
};

export function isSurfaceProfile(v: string): v is SurfaceProfile {
  return v === "minimal" || v === "standard" || v === "full";
}

/** Apply a surface profile to a config (deep-merged; the profile only sets the keys it cares about). */
export function applySurfaceProfile(config: GsdConfig, profile: SurfaceProfile): GsdConfig {
  return mergeGsdConfig(config, { ...SURFACE_PRESETS[profile], profiles: { ...(config.profiles as object), surface: profile } });
}

/** Read an install profile (`.gsd-profile` JSON at repoRoot) — a partial config preset shipped with the repo. */
export function readInstallProfile(repoRoot: string): Record<string, unknown> | null {
  const p = path.join(repoRoot, ".gsd-profile");
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective config: defaults → install profile (.gsd-profile) → surface profile → project config.
 * Later layers win (project config is most specific). Surface is read from the resolved config's profiles.surface.
 */
export function resolveProfiledConfig(repoRoot: string, projectConfig?: Partial<GsdConfig>): GsdConfig {
  let cfg = defaultGsdConfig();
  const install = readInstallProfile(repoRoot);
  if (install) cfg = mergeGsdConfig(cfg, install);
  if (projectConfig) cfg = mergeGsdConfig(cfg, projectConfig);
  const surface = (cfg.profiles as { surface?: string } | undefined)?.surface;
  if (surface && isSurfaceProfile(surface)) cfg = applySurfaceProfile(cfg, surface);
  return cfg;
}
