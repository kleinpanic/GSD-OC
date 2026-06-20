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
import { route } from "../engine/route.js";
import { isCodingWorkspace } from "./auto-engage.js";
import { optedOut } from "../engage/opt-out.js";
import { readGsdConfig } from "../engine/config.js";
import { resolveAgentOptional } from "../agents/index.js";

export type BeforeToolCallEvent = { toolName: string; params?: Record<string, unknown> };
export type BeforeToolCallContext = { agentId?: string; sessionKey?: string };
export type BeforeToolCallResult = { block?: boolean; blockReason?: string; params?: Record<string, unknown> };
export type EnforceGateDeps = { pluginConfig?: Record<string, unknown>; cwd?: string };

/** Tools that mutate source files — the only candidates for the planning gate. */
const MUTATING_TOOLS = new Set(["edit", "write", "file_write", "apply_patch", "multiedit", "str_replace", "create_file"]);

/** route() actions that mean "planning is not done yet" — editing code now is out-of-order GSD. */
const PRE_BUILD_ACTIONS = new Set(["discuss-phase", "plan-phase"]);

/**
 * Pure enforcement decision. Returns a block result (with a corrective reason) when a file-mutation tool is
 * called before GSD planning is complete; otherwise void (allow). `planningDir` defaults to <cwd>/.planning.
 */
export function enforceToolGate(
  event: BeforeToolCallEvent,
  _ctx: BeforeToolCallContext,
  deps: EnforceGateDeps = {},
): BeforeToolCallResult | void {
  if (!MUTATING_TOOLS.has((event.toolName ?? "").toLowerCase())) return; // not a file mutation → allow

  const cwd = deps.cwd ?? process.cwd();
  if (!isCodingWorkspace(cwd)) return; // not a coding workspace → GSD does not apply
  if (optedOut({ cwd, pluginConfig: deps.pluginConfig })) return; // .gsd-off / pluginConfig opt-out

  const planningDir = `${cwd.replace(/\/+$/, "")}/.planning`;
  const { config } = readGsdConfig(planningDir);
  if (config.workflow?.enforce_tool_gate === false) return; // explicit per-project disable

  const r = route(planningDir);
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
  if (r.action === "halt" && r.reason === "verification-fail") {
    return {
      block: true,
      blockReason: `GSD enforcement: a phase verification is FAILED and unresolved — resolve it before editing more code.`,
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
  if (!SPAWN_TOOLS.has((event.toolName ?? "").toLowerCase())) return;
  const cwd = deps.cwd ?? process.cwd();
  if (!isCodingWorkspace(cwd)) return;
  if (optedOut({ cwd, pluginConfig: deps.pluginConfig })) return;

  const params = event.params ?? {};
  const taskText = String(params.message ?? params.task ?? params.prompt ?? "");
  // Already a GSD subagent (persona already injected)? leave it.
  if (/\bGSD subagent\b|gsd-oc:persona/.test(taskText)) return;

  const role = gsdRoleFor(taskText);
  const def = resolveAgentOptional(role);
  const persona = def?.prompt ?? "";
  const preamble =
    `<!-- gsd-oc:persona -->\nYou are the GSD **${role}** subagent operating under the GSD methodology — ` +
    `follow this role's contract, not free-form work.\n\n${persona}\n\n--- Task ---\n`;
  const key = params.message != null ? "message" : params.task != null ? "task" : "message";
  return { params: { ...params, [key]: preamble + taskText } };
}
