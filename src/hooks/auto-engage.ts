import { homedir } from "node:os";
import { resolve, sep } from "node:path";

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

/** Default coding-workspace roots that trigger auto-engage (ENG-02). */
function codingWorkspaceRoots(): string[] {
  return [resolve(homedir(), "codeWS")];
}

/** True if `dir` is inside one of the coding-workspace roots. */
export function isCodingWorkspace(
  dir: string | undefined,
  roots: string[] = codingWorkspaceRoots(),
): boolean {
  if (!dir) return false;
  const target = resolve(dir);
  return roots.some((root) => {
    const r = resolve(root);
    return target === r || target.startsWith(r + sep);
  });
}

/** The GSD meta-prompt injected when auto-engage fires. Static guidance (cacheable). */
export const GSD_META_PROMPT = [
  "[GSD auto-engaged] You are operating under the GSD methodology for coding/big work.",
  "Follow the lifecycle: research → codebase-map → plan → execute → verify → ship.",
  "Drive the ported GSD subagents in order; persist artifacts under .planning/ in the",
  "target project directory. Do not require the user to type GSD slash-commands.",
].join(" ");

/**
 * `before_prompt_build` handler (ENG-02). Fires only when the turn's workspace is a coding
 * workspace; otherwise returns void (no injection) so trivial chat is never hijacked.
 *
 * Operator gate: requires `plugins.entries.gsd-oc.hooks.allowPromptInjection: true`
 * (documented in README; the plugin never mutates host config).
 */
export function autoEngageHandler(
  _event: BeforePromptBuildEvent,
  ctx: BeforePromptBuildContext,
): BeforePromptBuildResult | void {
  if (!isCodingWorkspace(ctx?.workspaceDir)) return;
  return { prependSystemContext: GSD_META_PROMPT };
}
