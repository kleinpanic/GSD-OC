/**
 * ENF-HOOK-01: the GSD enforcement gate (the keystone the parity review found missing). A `before_tool_call`
 * hook that turns GSD from advisory prose into a DETERMINISTIC refusal — it BLOCKS file-mutation tools when
 * the project is under GSD but the current phase has not been planned yet (route() says discuss/plan).
 *
 * Designed to be real but SAFE — it never bricks legitimate work:
 *  - Only file-MUTATION tools (edit/write/file_write/apply_patch/multiedit) are candidates. Reads, exec,
 *    git, and the gsd_* tools are never blocked.
 *  - Only fires when the workspace is a coding workspace AND GSD has STRUCTURE (.planning + a ROADMAP) AND
 *    route() says the next required step is a planning gate (discuss-phase / plan-phase) or a verification
 *    halt. A greenfield project (no .planning) or a project past planning (execute/verify/ship) is allowed.
 *  - Opt-out: `.gsd-off` / pluginConfig, or `workflow.enforce_tool_gate: false` in .planning/config.json.
 */
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { route } from "../engine/route.js";
import { optedOut } from "../engage/opt-out.js";
import { readGsdConfig } from "../engine/config.js";
import { resolveProfiledConfig } from "../engine/profile.js";
import { resolveWorkstreamDir } from "../engine/workstream.js";
import { resolveAgentOptional } from "../agents/index.js";

export type BeforeToolCallEvent = { toolName: string; params?: Record<string, unknown>; derivedPaths?: readonly string[] };
export type BeforeToolCallContext = { agentId?: string; sessionKey?: string };
export type BeforeToolCallResult = { block?: boolean; blockReason?: string; params?: Record<string, unknown> };
export type EnforceGateDeps = { pluginConfig?: Record<string, unknown>; cwd?: string };

/** Tools that mutate source files — the only candidates for the planning gate. */
const MUTATING_TOOLS = new Set(["edit", "write", "file_write", "apply_patch", "multiedit", "str_replace", "create_file"]);

/** route() actions that mean "planning is not done yet" — editing code now is out-of-order GSD. */
const PRE_BUILD_ACTIONS = new Set(["discuss-phase", "plan-phase"]);

/** Param keys that may hold the target file path of a mutation tool. */
const PATH_KEYS = ["file_path", "path", "file", "filePath", "target_file", "filename"];

/** Extract the target file path from a before_tool_call event (host-derived path first, then params).
 *  Guards every candidate to a non-empty STRING — a non-string derivedPaths[0] or an array-valued param
 *  must not reach path.resolve (which throws), nor silently mis-scope (CR-3, MED-3). */
export function targetPathOf(event: BeforeToolCallEvent): string | undefined {
  const d = event.derivedPaths;
  if (d && d.length && typeof d[0] === "string" && d[0]) return d[0];
  const p = event.params ?? {};
  for (const k of PATH_KEYS) {
    const v = p[k];
    if (typeof v === "string" && v) return v;
  }
  // FALSE-ALLOW fix (#1): a mutating tool may carry its target under an UNRECOGNIZED key (dest/uri/source_path/
  // target…) with no host-derived path. The fixed PATH_KEYS list would then return undefined → the caller falls
  // back to cwd → an out-of-order edit inside an unplanned project slips through when cwd is elsewhere. Fall back
  // to the first OWN string param that looks like a filesystem path (has a separator or a code-file extension), so
  // the edit is scoped to its real project instead of cwd. Still undefined only when nothing path-like exists.
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (typeof v === "string" && v && /[/\\]|\.[a-z0-9]{1,8}$/i.test(v)) return v;
  }
  return undefined;
}

/**
 * Walk up from `startDir` to find the GSD project root — the nearest ancestor whose `.planning` dir carries
 * a real GSD marker (STATE.md or ROADMAP.md). Requiring a marker (not bare `.planning/` existence) is what
 * stops a STRAY `.planning` (e.g. ~/.planning/research with no roadmap) from being mis-detected as a project
 * — which made enforcement mis-fire gateway-wide when cwd was the gateway home (live cross-contamination
 * + pathless-write landmine). A FILE named .planning never anchors (statSync .isDirectory), LOW-1.
 */
export function gsdProjectRoot(startDir: string): string | undefined {
  let cur = resolve(startDir);
  for (let i = 0; i < 64; i++) {
    try {
      const planning = `${cur}/.planning`;
      if (statSync(planning).isDirectory() && (existsSyncSafe(`${planning}/STATE.md`) || existsSyncSafe(`${planning}/ROADMAP.md`))) {
        return cur;
      }
    } catch {
      /* missing / perm — keep walking */
    }
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
  return undefined;
}

/** existsSync without importing it twice; statSync-based so a perm error is swallowed (not thrown). */
function existsSyncSafe(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure enforcement decision. Returns a block result (with a corrective reason) when a file-mutation tool is
 * called before GSD planning is complete; otherwise void (allow). `planningDir` defaults to <cwd>/.planning.
 */
export function enforceToolGate(
  event: BeforeToolCallEvent,
  _ctx: BeforeToolCallContext,
  deps: EnforceGateDeps = {},
): BeforeToolCallResult | void {
  // FALSE-ALLOW fix: trim AND lowercase — a whitespace-padded tool name ("  edit  ") otherwise fails the
  // MUTATING_TOOLS membership check and slips a pre-plan edit THROUGH the gate (the worst-case bypass).
  if (!MUTATING_TOOLS.has((event.toolName ?? "").trim().toLowerCase())) return; // not a file mutation → allow

  // Scope to the EDITED FILE's GSD project, NOT process.cwd() (the gateway home). Find the .planning root
  // by walking up from the file being edited; if the edit isn't inside a GSD project, GSD does not apply.
  const filePath = targetPathOf(event);
  const startDir = filePath ? dirname(resolve(deps.cwd ?? process.cwd(), filePath)) : (deps.cwd ?? process.cwd());
  const projectRoot = gsdProjectRoot(startDir);
  if (!projectRoot) return; // edit not inside any GSD project → allow

  if (optedOut({ cwd: projectRoot, pluginConfig: deps.pluginConfig })) return; // .gsd-off / pluginConfig opt-out

  const planningDir = resolveWorkstreamDir(`${projectRoot}/.planning`); // Flow-5: route over the active workstream track
  // Flow-6 fix: resolve the FULL config (defaults → .gsd-profile → project → surface) so a profile that disables
  // the gate (or a 'minimal' surface) actually reaches enforcement — not just the bare .planning/config.json.
  const config = resolveProfiledConfig(projectRoot, readGsdConfig(planningDir).overrides);
  if (config.workflow?.enforce_tool_gate === false) return; // explicit per-project disable

  const r = route(planningDir);
  // A FAILED, unresolved verification is a hard halt (route returns phase:null + reason verification-fail).
  // Check it BEFORE the greenfield guard below — both carry phase:null, but this one MUST block (verifier
  // caught the greenfield guard swallowing it as a dead branch).
  if (r.action === "halt" && r.reason === "verification-fail") {
    return {
      block: true,
      blockReason: `GSD enforcement: a phase verification is FAILED and unresolved — resolve it before editing more code.`,
    };
  }
  // Greenfield (no roadmap/phases) → route returns discuss-phase with phase:null. Don't block — there's no
  // plan structure to enforce against, and blocking would brick a fresh project. The auto-engage prompt
  // nudges toward gsd_orchestrate instead.
  if (r.phase == null) return;

  if (PRE_BUILD_ACTIONS.has(r.action)) {
    return {
      block: true,
      blockReason:
        `GSD enforcement: phase ${r.phase} is not planned yet (next GSD step: ${r.action}). ` +
        `Plan before editing — call gsd_orchestrate with your intent (or run the ${r.action} step) first. ` +
        `Opt out: add a .gsd-off file or set workflow.enforce_tool_gate:false in .planning/config.json.`,
    };
  }
  return; // route says execute/verify/ship/etc. → planning done → allow the edit
}

/** Spawn tools the agent uses to create subagents. */
const SPAWN_TOOLS = new Set(["sessions_spawn", "subagents", "task", "spawn_agent"]);

/** Infer the GSD persona (gsd-*) for a spawn task from its text. Ordered: first match wins. */
const ROLE_RULES: { re: RegExp; agent: string }[] = [
  { re: /\b(research|investigat|domain|framework|api docs)\b/i, agent: "gsd-phase-researcher" },
  { re: /\b(map|codebase|architecture|explore the code)\b/i, agent: "gsd-codebase-mapper" },
  { re: /\b(plan|plan-?check|breakdown)\b/i, agent: "gsd-planner" },
  { re: /\b(debug|flaky|fail|broken|crash|reproduce|bug)\b/i, agent: "gsd-debugger" },
  { re: /\b(secur|vulnerab|threat|audit|harden)\b/i, agent: "gsd-security-auditor" },
  { re: /\b(ui|frontend|component|design contract|sketch)\b/i, agent: "gsd-ui-researcher" },
  { re: /\b(eval|ai-?integration|llm|agent quality)\b/i, agent: "gsd-eval-planner" },
  { re: /\b(review|code review|code-review)\b/i, agent: "gsd-code-reviewer" },
  { re: /\b(verif|validate|goal-backward)\b/i, agent: "gsd-verifier" },
  { re: /\b(document|docs|readme)\b/i, agent: "gsd-doc-writer" },
  { re: /\b(execut|implement|build|write the code|scaffold)\b/i, agent: "gsd-executor" },
];

function gsdRoleFor(text: string): string {
  for (const r of ROLE_RULES) if (r.re.test(text)) return r.agent;
  return "gsd-executor"; // default — still a GSD persona, never a bare instruction-less subagent
}

/**
 * ENF-SPAWN: enforce that subagents spawned inside a GSD context carry a GSD PERSONA + instructions —
 * never a bare instruction-less subagent. Intercepts the spawn tool and REWRITES its message param to
 * prepend the matching gsd-* persona prompt. Returns the rewritten params (the host applies them), or void.
 */
export function enforceSpawnPersona(
  event: BeforeToolCallEvent,
  _ctx: BeforeToolCallContext,
  deps: EnforceGateDeps = {},
): BeforeToolCallResult | void {
  if (!SPAWN_TOOLS.has((event.toolName ?? "").trim().toLowerCase())) return; // trim too (same bypass class)
  // Scope to an actual GSD project (a .planning ancestor of cwd) so we never inject GSD personas into
  // non-GSD agents' spawns (finance/legal/etc.). No GSD project → leave the spawn untouched.
  const projectRoot = gsdProjectRoot(deps.cwd ?? process.cwd());
  if (!projectRoot) return;
  if (optedOut({ cwd: projectRoot, pluginConfig: deps.pluginConfig })) return;

  const params = event.params ?? {};
  // #3: pick the key whose value is actually present FIRST. If the instruction lives in an unknown key
  // (instructions/input/objective…) none of these are set — injecting a defaulted empty `message` would add a
  // bogus key AND leave the real instruction un-personaed (a false-allow of an instruction-less GSD subagent).
  // So bail out when no known instruction key is present, rather than clobbering with an empty default.
  const key = typeof params.message === "string" ? "message" : typeof params.task === "string" ? "task" : typeof params.prompt === "string" ? "prompt" : null;
  if (key === null) return; // unknown instruction shape — leave the spawn untouched (don't inject a bogus key)
  const taskText = String(params[key] ?? "");
  // Already a GSD subagent (persona already injected)? leave it.
  if (/\bGSD subagent\b|gsd-oc:persona/.test(taskText)) return;

  const role = gsdRoleFor(taskText);
  const def = resolveAgentOptional(role);
  const persona = def?.prompt ?? "";
  const preamble =
    `<!-- gsd-oc:persona -->\nYou are the GSD **${role}** subagent operating under the GSD methodology — ` +
    `follow this role's contract, not free-form work.\n\n${persona}\n\n--- Task ---\n`;
  // Write the persona back into the SAME key the instruction came from (resolved above, guaranteed present).
  return { params: { ...params, [key]: preamble + taskText } };
}
