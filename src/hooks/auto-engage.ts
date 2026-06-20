import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { classifyIntent } from "../engage/classify.js";
import { optedOut } from "../engage/opt-out.js";

/**
 * Event/context shapes for the `before_prompt_build` hook
 * (hook-types-C-yXhapS.d.ts:22-40, 368-387). Declared locally so this module type-checks
 * against the installed SDK without importing internal symbol paths.
 */
export type BeforePromptBuildEvent = { prompt: string; messages: unknown[] };
export type BeforePromptBuildContext = { workspaceDir?: string };
export type BeforePromptBuildResult = {
  systemPrompt?: string;
  prependContext?: string;
  appendContext?: string;
  prependSystemContext?: string;
  appendSystemContext?: string;
};

/** Default coding-workspace roots that trigger auto-engage (ENG-02). Operators can extend via pluginConfig. */
function codingWorkspaceRoots(extra: string[] = []): string[] {
  return [resolve(homedir(), "codeWS"), ...extra.map((r) => resolve(r))];
}

/** Filesystem markers that identify any directory as a real coding project (root-agnostic). */
const CODING_MARKERS = [".git", "package.json", ".planning", "pyproject.toml", "Cargo.toml", "go.mod", "tsconfig.json"];

/** True if `dir` itself looks like a coding project (has a marker). Path-independent — this is what makes
 *  auto-engage fire in agent workspaces (~/.openclaw/workspace-*) that are not under ~/codeWS. */
function hasCodingMarker(dir: string): boolean {
  try {
    return CODING_MARKERS.some((m) => existsSync(join(dir, m)));
  } catch {
    return false;
  }
}

/**
 * True if `dir` is a coding workspace: either inside a configured root (default ~/codeWS + pluginConfig
 * `codingRoots`), OR it carries a coding-project marker (.git/package.json/.planning/…). The marker path
 * is root-agnostic so GSD auto-engages for real projects regardless of where the agent's workspace lives.
 */
export function isCodingWorkspace(
  dir: string | undefined,
  roots: string[] = codingWorkspaceRoots(),
): boolean {
  if (!dir) return false;
  const target = resolve(dir);
  const underRoot = roots.some((root) => {
    const r = resolve(root);
    return target === r || target.startsWith(r + sep);
  });
  return underRoot || hasCodingMarker(target);
}

/** The GSD meta-prompt injected when auto-engage fires. Static guidance (cacheable). */
export const GSD_META_PROMPT = [
  "[GSD auto-engaged] You are operating under the GSD methodology for coding/big work.",
  "Follow the lifecycle: research → codebase-map → plan → execute → verify → ship.",
  "Drive the ported GSD subagents in order; persist artifacts under .planning/ in the",
  "target project directory. Do not require the user to type GSD slash-commands.",
].join(" ");

/** Opt-out signals injected by the registration site (index.ts); defaults preserve Phase-1 behavior. */
export type AutoEngageDeps = {
  pluginConfig?: Record<string, unknown>;
  sessionDisabled?: boolean;
};

/**
 * `before_prompt_build` handler — the D-05 composition (ENG-01/ENG-03/ENG-04):
 *
 *   engage = isCodingWorkspace(ctx.workspaceDir)   // ENG-02 codeWS gate (Phase 1)
 *         && classifyIntent(event.prompt).engage   // ENG-01 intent gate
 *         && !optedOut({ cwd, pluginConfig, sessionDisabled })   // ENG-03 opt-outs
 *
 * Returns the GSD meta-prompt injection only when all signals agree; otherwise void so trivial
 * chat is never hijacked (ENG-04 negative). The optional `deps` arg keeps the Phase-1 two-arg
 * call signature behaving identically when no opt-out applies.
 *
 * Opt-out (b) — per-session toggle — LIMITATION (D-03 fallback): the before_prompt_build ctx is a
 * PluginHookAgentContext (hook-types-C-yXhapS.d.ts:368-388) and exposes NO getSessionExtension
 * reader; that reader lives only on PluginHookToolContext (hook-types-C-yXhapS.d.ts:686). So the
 * toggle's LIVE read-back is NOT cleanly available in this hook. Opt-out (a) `.gsd-off` marker and
 * (c) host pluginConfig are authoritative here; the toggle is carried via the injected
 * `sessionDisabled` flag (parseToggle + the registration scaffold in index.ts), NOT a faked ctx
 * read. Full toggle read-back is gateway-gated -> revisit in Phase 7.
 *
 * Operator gate: requires `plugins.entries.gsd-oc.hooks.allowPromptInjection: true`
 * (documented in README; the plugin never mutates host config).
 */
export function autoEngageHandler(
  event: BeforePromptBuildEvent,
  ctx: BeforePromptBuildContext,
  deps: AutoEngageDeps = {},
): BeforePromptBuildResult | void {
  // Fall back to process.cwd() for the codeWS gate too (not just the opt-out check): a missing
  // ctx.workspaceDir must not block activation when the real cwd is inside a coding workspace (cross-AI F5).
  const cwd = ctx?.workspaceDir ?? process.cwd();
  // Operators can add coding roots via pluginConfig.codingRoots (string[]); markers cover the rest.
  const extraRoots = Array.isArray((deps.pluginConfig as { codingRoots?: unknown })?.codingRoots)
    ? ((deps.pluginConfig as { codingRoots: string[] }).codingRoots)
    : [];
  const engage =
    isCodingWorkspace(cwd, codingWorkspaceRoots(extraRoots)) &&
    classifyIntent(event.prompt).engage &&
    !optedOut({ cwd, pluginConfig: deps.pluginConfig, sessionDisabled: deps.sessionDisabled });
  if (!engage) return;
  return { prependSystemContext: GSD_META_PROMPT };
}
