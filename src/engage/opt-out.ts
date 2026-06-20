import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * ENG-03 opt-out mechanisms (D-02 / D-03 / D-04).
 *
 * The plugin READS the host plugin config; it NEVER writes ~/.openclaw/openclaw.json or any
 * host config (R0.3). All functions here are pure except hasGsdOffMarker, which does fs.existsSync.
 */

/**
 * (a) D-02: a `.gsd-off` file disables engage for the project. WR-02: opt-out scope must
 * MATCH activation scope — activation now walks UP from cwd looking for coding markers, so a
 * `.gsd-off` placed in any ANCESTOR (the project root) must suppress engage for a subdir cwd.
 * We walk UP from cwd to the filesystem root, checking `${dir}/.gsd-off` and
 * `${dir}/.planning/.gsd-off` at each level (bounded — breaks at root).
 */
export function hasGsdOffMarker(cwd: string, home = homedir()): boolean {
  let cur = resolve(cwd);
  const stopAt = resolve(home);
  for (;;) {
    if (existsSync(join(cur, ".gsd-off")) || existsSync(join(cur, ".planning", ".gsd-off"))) {
      return true;
    }
    const parent = dirname(cur);
    // L-1: bound the walk at the user's home dir (inclusive). A `.gsd-off` ABOVE home (e.g. `/.gsd-off`)
    // is out of GSD's scope — it must not silently disable engage for every user/project on the box.
    if (parent === cur || cur === stopAt) return false;
    cur = parent;
  }
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
  // WR-04: anchor to an explicit directive SHAPE at the start of the prompt, not a loose
  // substring. "is gsd on the roadmap" must NOT toggle (the bare "gsd on" appears mid-sentence,
  // not as a directive). The directive is `gsd <on|off>` or `<enable|disable> gsd` at the head;
  // "first match wins" still resolves "gsd off then on" → "off".
  const m = /^(?:gsd[:\s]+(on|off)|(enable|disable)\s+gsd)\b/.exec(text);
  if (!m) return null;
  if (m[1]) return m[1] as "off" | "on";
  return m[2] === "enable" ? "on" : "off";
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
