import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
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

/**
 * Engagement modes (configurable via pluginConfig.engageMode — official-release versatility):
 *  - "workspace" (default): engage when cwd is a coding workspace (a configured root OR a project marker)
 *    AND the intent is coding work.
 *  - "intent": engage on coding INTENT alone, regardless of cwd — for users who don't keep code in a fixed
 *    place, or want GSD driven by what they ask rather than where they are.
 *  - "off": never auto-engage (the gsd_* tools still work on demand).
 */
export type EngageMode = "workspace" | "intent" | "off";

/** Expand a leading `~` and `$VAR`/`${VAR}` env refs in a configured root path (so users can write "~/work"
 *  or "$PROJECTS"). Unknown vars expand to empty (the resolve still yields a usable absolute path). */
function expandPath(p: string): string {
  let s = p.startsWith("~") ? homedir() + p.slice(1) : p;
  s = s.replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, a, b) => process.env[a || b] ?? "");
  return resolve(s);
}

/** The built-in default coding root: `$HOME/codeWS` (computed at runtime — not a hardcoded username). It's a
 *  convenience for the common case; users who keep code elsewhere are covered by markers + configured roots,
 *  and can drop it with `includeDefaultRoot: false`. */
function defaultRoot(): string {
  return resolve(homedir(), "codeWS");
}

/** Coding-workspace roots: the default `$HOME/codeWS` (unless disabled) + any operator-configured dirs.
 *  Real projects are ALSO detected root-agnostically by markers below — roots only matter for marker-less dirs.
 *  Accepts multiple dirs with `~`/`$VAR` expansion. */
function codingWorkspaceRoots(extra: string[] = [], includeDefault = true): string[] {
  const base = includeDefault ? [defaultRoot()] : [];
  return [...base, ...extra.filter((r) => typeof r === "string" && r.length > 0).map(expandPath)];
}

/** Read the engage config from the plugin config LAYER (pluginConfig), defensively. Surfaced as the plugin's
 *  declared configSchema (index.ts) so operators set it through the standard OpenClaw plugin config. */
export function resolveEngageConfig(pluginConfig: Record<string, unknown> | undefined): {
  roots: string[];
  mode: EngageMode;
} {
  const pc = pluginConfig ?? {};
  const rootsRaw = Array.isArray((pc as { codingRoots?: unknown }).codingRoots)
    ? ((pc as { codingRoots: unknown[] }).codingRoots.filter((r) => typeof r === "string") as string[])
    : [];
  const includeDefault = (pc as { includeDefaultRoot?: unknown }).includeDefaultRoot !== false;
  const m = (pc as { engageMode?: unknown }).engageMode;
  const mode: EngageMode = m === "intent" || m === "off" ? m : "workspace";
  return { roots: codingWorkspaceRoots(rootsRaw, includeDefault), mode };
}

/** Filesystem markers that identify any directory as a real coding project (root-agnostic). NOTE: `.planning` is
 *  NOT a bare marker here — a stray non-GSD `.planning` (e.g. ~/.planning/research with no STATE/ROADMAP) would
 *  otherwise make the walk-up treat EVERY dir under that ancestor as a coding workspace, misfiring gateway-wide.
 *  A `.planning` only counts when it carries a GSD marker (STATE.md/ROADMAP.md) — checked separately below,
 *  consistent with enforce-gate's gsdProjectRoot. */
const CODING_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "tsconfig.json"];

/** A `.planning` dir counts as a project marker ONLY if it's a real GSD project (has STATE.md or ROADMAP.md). */
function hasGsdPlanning(dir: string): boolean {
  try {
    return existsSync(join(dir, ".planning", "STATE.md")) || existsSync(join(dir, ".planning", "ROADMAP.md"));
  } catch {
    return false;
  }
}

/** True if `dir` (or any ANCESTOR up to the filesystem root) carries a coding-project marker.
 *  Path-independent — this is what makes auto-engage fire in agent workspaces
 *  (~/.openclaw/workspace-*) not under ~/codeWS. WR-01: a SUBDIR of a coding project (src/,
 *  packages/foo) must engage too, so we walk UP from `dir` to root (bounded — breaks when the
 *  parent stops changing, i.e. at the root). */
function hasCodingMarker(dir: string): boolean {
  try {
    let cur = resolve(dir);
    for (;;) {
      if (CODING_MARKERS.some((m) => existsSync(join(cur, m))) || hasGsdPlanning(cur)) return true;
      const parent = dirname(cur);
      if (parent === cur) return false; // reached filesystem root
      cur = parent;
    }
  } catch {
    return false;
  }
}

/**
 * True if `dir` is a coding workspace: either a PROJECT under a configured root (the `<root>/<Lang>/<Project>`
 * convention — depth ≥ 2 below the root, e.g. ~/codeWS/JavaScript/GSD-OC), OR it carries a coding-project marker
 * (.git/package.json/.planning/…). The marker path is root-agnostic so GSD auto-engages for real projects wherever
 * the agent's workspace lives.
 *
 * The depth rule INFERS the machine's apparent layout instead of treating any descendant as a project: the root
 * itself (~/codeWS) and the bare language layer (~/codeWS/JavaScript) are organizational dirs, NOT projects — so
 * GSD does not engage there, and stray dirs created directly under the root are not mistaken for projects.
 */
export const PROJECT_DEPTH = 2; // <root>/<Lang>/<Project>

export function isCodingWorkspace(
  dir: string | undefined,
  roots: string[] = codingWorkspaceRoots(), // default includes $HOME/codeWS (callers like bootstrap-inject rely on it)
): boolean {
  if (!dir) return false;
  const target = resolve(dir);
  // A marker makes ANY dir a project (root-agnostic) — checked first so a marked dir at any depth still engages.
  if (hasCodingMarker(target)) return true;
  const defaultR = defaultRoot();
  return roots.some((root) => {
    const r = resolve(root);
    if (target !== r && !target.startsWith(r + sep)) return false;
    // The DEFAULT ~/codeWS root follows the machine's `<root>/<Lang>/<Project>` convention: only a project-DEPTH
    // descendant engages, so the root + the bare <Lang> layer (and stray dirs dropped at the root) are NOT mistaken
    // for projects. An OPERATOR-CONFIGURED root is literal — they opted in deliberately and may point straight at a
    // project, so any descendant (incl. the root itself) engages.
    if (r !== defaultR) return true;
    const rel = target.slice(r.length).split(sep).filter(Boolean);
    return rel.length >= PROJECT_DEPTH;
  });
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
  const { roots, mode } = resolveEngageConfig(deps.pluginConfig);
  if (mode === "off") return; // operator disabled auto-engage entirely
  // Intent + opt-out gates apply in every mode. The WORKSPACE gate applies only in "workspace" mode —
  // "intent" mode engages on coding intent anywhere (versatile for non-fixed-dir setups).
  const intentEngages =
    classifyIntent(event.prompt).engage &&
    !optedOut({ cwd, pluginConfig: deps.pluginConfig, sessionDisabled: deps.sessionDisabled });
  if (!intentEngages) return;
  if (mode === "workspace" && !isCodingWorkspace(cwd, roots)) return;
  return { prependSystemContext: GSD_META_PROMPT };
}
