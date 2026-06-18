import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * ENG-03 opt-out mechanisms (D-02 / D-03 / D-04).
 *
 * The plugin READS the host plugin config; it NEVER writes ~/.openclaw/openclaw.json or any
 * host config (R0.3). All functions here are pure except hasGsdOffMarker, which does fs.existsSync.
 */

/** (a) D-02: a `.gsd-off` file in cwd OR `${cwd}/.planning/.gsd-off` disables engage for the project. */
export function hasGsdOffMarker(cwd: string): boolean {
  return existsSync(join(cwd, ".gsd-off")) || existsSync(join(cwd, ".planning", ".gsd-off"));
}

/**
 * (c) D-04: the operator-set host plugin config disables engage. Read-only.
 * Opt-out iff `disabled === true` OR `autoEngage === false`. Unknown/malformed values are
 * treated as non-opt-out (default engage) so a malformed config cannot silently disable (T-05-01).
 */
export function configDisablesEngage(pluginConfig: Record<string, unknown> | undefined): boolean {
  if (!pluginConfig) return false;
  return pluginConfig.disabled === true || pluginConfig.autoEngage === false;
}

/**
 * (b) D-03: pure parse of the per-session toggle phrase. Live read-back in the
 * before_prompt_build hook is not cleanly available (see src/hooks/auto-engage.ts) — this
 * parse is the testable half; wiring is via the injected `sessionDisabled` dep + the
 * registration scaffold in index.ts.
 */
export function parseToggle(prompt: string): "off" | "on" | null {
  const text = (prompt ?? "").trim().toLowerCase();
  if (/\bgsd\b\s*:?\s*off\b|\bdisable\s+gsd\b/.test(text)) return "off";
  if (/\bgsd\b\s*:?\s*on\b|\benable\s+gsd\b/.test(text)) return "on";
  return null;
}

/** Composed suppression: opt-out if ANY mechanism applies. */
export function optedOut(args: {
  cwd: string;
  pluginConfig?: Record<string, unknown>;
  sessionDisabled?: boolean;
}): boolean {
  return (
    hasGsdOffMarker(args.cwd) ||
    configDisablesEngage(args.pluginConfig) ||
    args.sessionDisabled === true
  );
}
