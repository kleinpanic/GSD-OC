import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { toolPluginMetadataSymbol } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import fs from "node:fs";
import { autoEngageHandler } from "./hooks/auto-engage.js";
import { autoAdvanceHandler } from "./hooks/auto-advance.js";
import { runSubagent, type RunSubagentApi } from "./dispatch/run-subagent.js";
import { readState } from "./state/read-state.js";
import { routerMetadataTools } from "./routers/routers.js";
import { buildWiredRouterTools } from "./routers/route-wire.js";
import { registerInternalHook, isAgentBootstrapEvent } from "openclaw/plugin-sdk/hook-runtime";
import { gsdBootstrapHandler, type AgentBootstrapEvent } from "./engage/bootstrap-inject.js";
import { retrieve } from "./retrieval/retrieve.js";
import { embedAvailable } from "./retrieval/embed.js";
import { selectPath } from "./orchestrate/select-path.js";
import { readGsdConfig, bootstrapGsdConfig } from "./engine/config.js";
import { resolveProfiledConfig, applySurfaceProfile, isSurfaceProfile } from "./engine/profile.js";
import { route as routeEngine } from "./engine/route.js";
import { enforceToolGate, enforceSpawnPersona, gsdProjectRoot } from "./hooks/enforce-gate.js";
import { setStatus, recordProgress, addDecision, addBlocker } from "./engine/mutate.js";
import { addPhase, scaffoldPhaseDir, updatePlanProgress, markPhaseComplete, markRequirementComplete, completeMilestone } from "./engine/lifecycle.js";
import { scaffoldPlanning } from "./engine/scaffold.js";
import { contextTemplate, artifactName } from "./engine/artifacts.js";
import { buildProgress } from "./engine/progress.js";
import { undoLast } from "./engine/undo.js";
import { createAutoRepo, type RepoMode } from "./engine/repo.js";
import { createWorkBranch } from "./engine/branch.js";
import { resolveReviewer, crossAiReview, type ReviewFinding } from "./orchestrate/cross-ai-review.js";
import path from "node:path";
import { validateArtifacts, verifyPhaseCompleteness, validateConsistency, validateHealth, gapCheck } from "./engine/verify.js";
import { scanUat, auditOpen } from "./engine/audit.js";
import { pauseWork, resumeWork, writeThread, listThreads, closeThread, capture } from "./engine/session.js";
import { buildCheckpoint, renderCheckpointDiscord, parseCheckpointReply, type CheckpointType, type GateOption } from "./engine/checkpoint.js";
import { addLearning, queryLearnings, pruneLearnings } from "./engine/learnings.js";
import { scanInjection } from "./engine/security.js";
import { suggestFlags } from "./orchestrate/flags.js";
import { VERB_TO_SUBAGENT } from "./orchestrate/execute-path.js";
import { resolveAgentOptional } from "./agents/index.js";
import { resolveWorkstreamDir, listWorkstreams, createWorkstream, switchWorkstream, completeWorkstream, suggestWorkstream, activeWorkstream } from "./engine/workstream.js";
import { executePath, makeSubagentDispatcher } from "./orchestrate/execute-path.js";
import { runAutonomous, makeActionDispatcher } from "./orchestrate/autonomous.js";
import { runExecuteWave, makeUnitDispatcher, discoverPlanUnits } from "./orchestrate/parallel-plan.js";

const PLUGIN_ID = "gsd-oc";
const PLUGIN_NAME = "GSD-OC";
const PLUGIN_DESCRIPTION = "GSD lifecycle orchestration for OpenClaw — native, no Claude Code.";

const ORCHESTRATE_TOOL = "gsd_orchestrate";
const RETRIEVE_TOOL = "gsd_retrieve";
const SETTINGS_TOOL = "gsd_settings";
const STATE_TOOL = "gsd_state";
const COMMAND_TOOL = "gsd_command";
const WORKSTREAM_TOOL = "gsd_workstream";
const VERIFY_TOOL = "gsd_verify";
const SESSION_TOOL = "gsd_session";
const LEARNINGS_TOOL = "gsd_learnings";

/** TypeBox schema for gsd_learnings — cross-project knowledge store (add/query/prune). */
const learningsParams = Type.Object(
  {
    op: Type.String({ description: "add | query | prune" }),
    kind: Type.Optional(Type.String({ description: "decision | lesson | pattern (for add/query)." })),
    text: Type.Optional(Type.String({ description: "For add: the learning; for query: the search text." })),
    tags: Type.Optional(Type.Array(Type.String())),
    tag: Type.Optional(Type.String({ description: "For query: filter by tag." })),
    keep: Type.Optional(Type.Number({ description: "For prune: how many recent entries to keep." })),
  },
  { additionalProperties: false },
);

/** TypeBox schema for gsd_session — pause/resume + thread + capture + checkpoint gate lifecycle features. */
const sessionParams = Type.Object(
  {
    op: Type.String({ description: "pause | resume | thread | threads | close-thread | capture | checkpoint | checkpoint-reply" }),
    reason: Type.Optional(Type.String({ description: "For pause: why." })),
    next_step: Type.Optional(Type.String({ description: "For pause: the next step to resume from." })),
    name: Type.Optional(Type.String({ description: "Thread name (for thread/close-thread)." })),
    content: Type.Optional(Type.String({ description: "For thread: the note text." })),
    text: Type.Optional(Type.String({ description: "For capture: the idea/task text. For checkpoint: the gate prompt. For checkpoint-reply: the human's reply (number / id / label / custom_id)." })),
    type: Type.Optional(Type.String({ description: "For capture: idea|task|seed|note. For checkpoint: decision|human-verify|human-action." })),
    options: Type.Optional(Type.Array(Type.Object({ id: Type.String(), label: Type.String() }), { description: "For checkpoint (decision gates) / checkpoint-reply: the gate's choices." })),
  },
  { additionalProperties: false },
);

/** TypeBox schema for gsd_verify — native integrity checks (validate-artifacts gate + verify/validate verbs). */
const verifyParams = Type.Object(
  {
    op: Type.String({ description: "validate-artifacts | phase-completeness | consistency | gap | uat | audit-open | health" }),
    phase: Type.Optional(Type.String({ description: "Phase number (for phase-completeness)." })),
  },
  { additionalProperties: false },
);

/** TypeBox schema for gsd_workstream — manage parallel GSD tracks (list/create/switch/complete/suggest). */
const workstreamParams = Type.Object(
  {
    op: Type.String({ description: "list | create | switch | complete | suggest | active" }),
    name: Type.Optional(Type.String({ description: "Workstream name (for create/switch/complete)." })),
    intent: Type.Optional(Type.String({ description: "For 'suggest': the coding intent → the track it belongs to." })),
  },
  { additionalProperties: false },
);

/** TypeBox schema for gsd_command — invoke ANY individual GSD command/skill by name, with intent-driven flags. */
const commandParams = Type.Object(
  {
    command: Type.String({ description: "The GSD command/skill/workflow to run (e.g. 'code-review', 'debug', 'docs-update', 'secure-phase', 'verify-work'). Bare name, no leading slash." }),
    flags: Type.Optional(Type.String({ description: "Explicit flags/args (e.g. '--all --forensic'). Merged with flags inferred from `intent`." })),
    intent: Type.Optional(Type.String({ description: "Free-text intent; used to infer flags (e.g. 'review everything' → --all) and to retrieve the command's guidance." })),
  },
  { additionalProperties: false },
);

/** TypeBox schema for the gsd_state mutation tool (ENG-WRITE-01). */
const stateParams = Type.Object(
  {
    op: Type.String({ description: "init | branch | progress | undo | set-status | record-progress | add-decision | add-blocker | add-phase | scaffold-phase | update-plan-progress | complete-phase | complete-requirement | complete-milestone" }),
    status: Type.Optional(Type.String({ description: "For set-status (e.g. planning|executing|complete|error)." })),
    decision: Type.Optional(Type.String({ description: "For add-decision: the decision text." })),
    blocker: Type.Optional(Type.String({ description: "For add-blocker: the blocker text." })),
    total_plans: Type.Optional(Type.Number()),
    completed_plans: Type.Optional(Type.Number()),
    total_phases: Type.Optional(Type.Number()),
    completed_phases: Type.Optional(Type.Number()),
    name: Type.Optional(Type.String({ description: "For add-phase: the phase name." })),
    goal: Type.Optional(Type.String({ description: "For add-phase: the phase goal." })),
    phase: Type.Optional(Type.String({ description: "Phase number for scaffold-phase/update-plan-progress/complete-phase." })),
    plans: Type.Optional(Type.Number({ description: "For update-plan-progress: total plans." })),
    done: Type.Optional(Type.Number({ description: "For update-plan-progress: completed plans." })),
    req: Type.Optional(Type.String({ description: "For complete-requirement: the REQ id (e.g. RET-01)." })),
    version: Type.Optional(Type.String({ description: "For complete-milestone: the milestone version (e.g. v1.1)." })),
    create_repo: Type.Optional(Type.Boolean({ description: "For init: also create a GitHub repo (private by default per config.git.auto_repo) + push the scaffold." })),
    kind: Type.Optional(Type.String({ description: "For branch: phase | milestone | quick (which branching template)." })),
  },
  { additionalProperties: false },
);

/** TypeBox schema for the orchestrator tool's parameters. */
const orchestrateParams = Type.Object(
  {
    intent: Type.Optional(
      Type.String({ description: "Freeform description of the coding/big-work intent to route through GSD." }),
    ),
    drive: Type.Optional(
      Type.Boolean({ description: "Actually dispatch the path's GSD subagents (halts at decision gates), instead of only returning the plan." }),
    ),
    autoGates: Type.Optional(
      Type.Boolean({ description: "When driving, auto-proceed through decision gates (autonomous run) instead of halting for approval." }),
    ),
    autonomous: Type.Optional(
      Type.Boolean({ description: "Drive the FULL multi-phase loop (re-read route() per step until the milestone completes), not just a single path. Honors autoGates + a no-progress guard." }),
    ),
    wave: Type.Optional(
      Type.Boolean({ description: "Execute the active phase's plans as a PARALLEL wave — concurrent executors, each in its own git worktree, merges serialized (--wave). Requires a git repo." }),
    ),
  },
  { additionalProperties: false },
);

/** TypeBox schema for the hybrid-retrieval tool's parameters (RET-07). */
const retrieveParams = Type.Object(
  {
    intent: Type.String({
      description: "Free-text coding/big-work intent; returns the most relevant GSD skills + subagents (long-tail included).",
    }),
    topK: Type.Optional(Type.Number({ description: "Max results to return (default 8)." })),
  },
  { additionalProperties: false },
);

/** TypeBox schema for the gsd_settings tool. */
const settingsParams = Type.Object(
  {
    profile: Type.Optional(Type.String({ description: "Apply a surface profile for this read: minimal | standard | full." })),
    bootstrap: Type.Optional(
      Type.Boolean({ description: "Write a default GSD config if none exists (never overwrites)." }),
    ),
  },
  { additionalProperties: false },
);

/**
 * The gsd-oc plugin entry.
 *
 * OR-1 = Option A: built with `definePluginEntry` (so we get hooks + service + tool +
 * runtime), then the tool-plugin metadata symbol is attached so `openclaw plugins
 * build`/`validate` (which call `getToolPluginMetadata(entry)`) accept it.
 */
const entry = definePluginEntry({
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: PLUGIN_DESCRIPTION,
  register(api) {
    // Capture the registration-time api for the orchestrator's live subagent dispatch. The execute()
    // 5th-arg context is unreliable — some runtime call sites pass `void 0` there — so the closure api
    // (which carries `runtime.subagent`) is the robust source; the context arg is a fallback.
    const pluginApi = api as { runtime?: { subagent?: unknown } };

    // Service: the gsd-oc lifecycle service (minimal in Phase 1 — start is a no-op).
    api.registerService({
      id: PLUGIN_ID,
      description: "GSD-OC lifecycle service",
      async start() {
        /* The loop is hook-driven (D-04/D-05): advance runs via the before_agent_finalize
         * hook + code-driven fan-out, so no background service work is needed. */
      },
    } as never);

    // Opt-out (c) D-04: read the operator-set host plugin config (read-only). The accessor is
    // surfaced as `pluginConfig?: Record<string, unknown>` (registry-types-bnUgkf2q.d.ts:190 /
    // types-Tcpca_5M.d.ts:8127). Read defensively without asserting an invented method; the plugin
    // NEVER writes host config (R0.3 — never mutate ~/.openclaw/openclaw.json).
    const pluginConfig = (api as { pluginConfig?: Record<string, unknown> }).pluginConfig;

    // Opt-out (b) D-03 scaffold: register the session-extension slot so the toggle has a home.
    // LIMITATION (documented, not faked): the before_prompt_build ctx is a PluginHookAgentContext
    // (hook-types-C-yXhapS.d.ts:368-388) with NO getSessionExtension reader — that reader lives only
    // on PluginHookToolContext (:686). So the toggle's LIVE read-back is not cleanly available in the
    // prompt hook this release; `sessionDisabled` therefore stays unset from this hook path. Opt-outs
    // (a) `.gsd-off` and (c) pluginConfig are authoritative. Full read-back is gateway-gated -> Phase 7.
    const sessionState = (
      api as {
        session?: { state?: { registerSessionExtension?: (ext: unknown) => void } };
      }
    ).session?.state;
    sessionState?.registerSessionExtension?.({
      namespace: "gsd-oc",
      description:
        "Per-session GSD auto-engage toggle (parseToggle off/on). Read-back is gateway-gated (Phase 7); slot reserved.",
      sessionEntrySlotKey: "gsdAutoEngageDisabled",
    });

    // Auto-engage: inject the GSD meta-prompt for coding-workspace turns (ENG-02), now gated by the
    // D-05 composition (classifyIntent + optedOut). Pass the read-only pluginConfig through (opt-out c).
    // Uses api.registerHook (NOT api.on — api.on does not exist on the installed SDK).
    // NOTE: api.registerHook REQUIRES opts.name at runtime — the registry throws
    // "hook registration missing name" otherwise (registry-B8gzOJBq.js:3082). Surfaced by a
    // real gateway install (`openclaw plugins install`), not by unit tests / `plugins validate`.
    api.registerHook(
      "before_prompt_build",
      ((event: unknown, ctx: unknown) =>
        autoEngageHandler(
          event as Parameters<typeof autoEngageHandler>[0],
          ctx as Parameters<typeof autoEngageHandler>[1],
          { pluginConfig },
        )) as never,
      { name: "gsd-oc:auto-engage" } as never,
    );

    // Auto-advance: the loop's cross-turn lever (ORCH-04). before_agent_finalize re-runs
    // route() and revises for a code-driven step, guarded by stopHookActive + maxAttempts.
    // Inert unless the operator sets hooks.allowConversationAccess (README; never mutated).
    api.registerHook("before_agent_finalize", autoAdvanceHandler as never, {
      name: "gsd-oc:auto-advance",
    } as never);

    // ENF-HOOK-01: the GSD enforcement gate (the keystone). before_tool_call BLOCKS file-mutation tools when
    // the project is under GSD but the current phase isn't planned yet — deterministic refusal, not prose.
    // Safe by construction: only file edits, only when route() says discuss/plan, opt-out via .gsd-off/config.
    api.registerHook(
      "before_tool_call",
      ((event: unknown, ctx: unknown) => {
        // A buggy gate must NEVER brick every tool call — fail OPEN (allow) on any internal error (CR-3).
        try {
          // ENF-SPAWN: subagents spawned in a GSD context must carry a GSD persona (inject it). Runs first —
          // if it rewrites the spawn params, the edit-gate (which ignores spawn tools) returns void anyway.
          const spawn = enforceSpawnPersona(
            event as Parameters<typeof enforceSpawnPersona>[0],
            ctx as Parameters<typeof enforceSpawnPersona>[1],
            { pluginConfig },
          );
          if (spawn) return spawn;
          return enforceToolGate(
            event as Parameters<typeof enforceToolGate>[0],
            ctx as Parameters<typeof enforceToolGate>[1],
            { pluginConfig },
          );
        } catch (e) {
          console.warn(`[gsd-oc] enforce-gate error (failing open): ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        }
      }) as never,
      { name: "gsd-oc:enforce-gate" } as never,
    );

    // R0.5 auto-engage (ROBUST, canonical): the `agent:bootstrap` internal hook fires on the
    // embedded/gateway agent path and is backed by the SAME runner the agent consults — unlike
    // before_prompt_build, it is NOT wiped by the per-load hook-runner re-init. It owns the
    // order-10 AGENTS content with the imperative GSD policy, gated to ~/codeWS + opt-out. This
    // delivers auto-engage WITHOUT requiring a per-project on-disk AGENTS.md write.
    registerInternalHook("agent:bootstrap", (event) => {
      if (!isAgentBootstrapEvent(event)) return;
      gsdBootstrapHandler(event as unknown as AgentBootstrapEvent);
    });

    // Orchestrator tool: code-driven dispatch entry point (ORCH-01 / AGT-02).
    api.registerTool({
      name: ORCHESTRATE_TOOL,
      label: "GSD Orchestrate",
      description:
        "Route a coding/big-work intent through the GSD lifecycle by dispatching the appropriate GSD subagent.",
      parameters: orchestrateParams,
      async execute(
        _toolCallId: string,
        args: { intent?: string; drive?: boolean; autoGates?: boolean; autonomous?: boolean; wave?: boolean },
        _signal?: unknown,
        _onUpdate?: unknown,
        context?: { api?: unknown },
      ) {
       try {
        const intent = (args?.intent ?? "").trim();
        const state = await readState(".planning");
        const base = {
          engaged: true,
          current_phase: state.current_phase,
          current_phase_name: state.current_phase_name,
          intent: intent || null,
        };
        if (!intent) return base;
        // PATH-01: drive the finite GSD path from retrieval, not a static table — retrieve the relevant
        // skills/subagents for this intent, then order them into a lifecycle path (long-tail included).
        const retrieved = await retrieve(intent, { topK: 12 });
        const path = selectPath({ intent, retrieved: retrieved.map((r) => ({ docId: r.docId })) });
        const planned = {
          ...base,
          path: path.map((s) => ({ verb: s.verb, skill: s.skill, gate: s.gate, reason: s.reason })),
          relevant_skills: retrieved.slice(0, 8).map((r) => ({ id: r.docId, modality: r.modalities })),
          // WR-01: warn when the long-tail ranking is degraded (semantic configured but unreachable).
          retrieval_degraded: embedAvailable(process.env) && !retrieved.some((r) => (r.modalities ?? []).includes("semantic")),
          // Agent-driven execution (the OpenClaw-native model — the plugin plans, the agent executes):
          // dispatch each NON-gate step's `skill` as a subagent via your sessions_spawn tool, in order;
          // PAUSE at each `gate:true` step for the required discussion/approval before continuing.
          how_to_execute:
            "Dispatch each non-gate path step's skill as a subagent (sessions_spawn) in order; pause at gate:true steps for approval. Persist artifacts under .planning/.",
        };
        // PATH-execution: actually DRIVE the path (dispatch subagents, halt at gates) when asked AND the
        // live subagent runtime is reachable. Prefer the closure api (reliable), fall back to the context
        // arg; otherwise return the plan (graceful — never crash).
        const ctxApi = (context?.api ?? null) as { runtime?: { subagent?: unknown } } | null;
        const runtimeApi = pluginApi?.runtime?.subagent ? pluginApi : ctxApi?.runtime?.subagent ? ctxApi : null;
        // GSD personas must run under a real allowlisted agent (subagents.allowAgents). Default "dev" —
        // present in every primary agent's allowlist; operator-overridable via pluginConfig.workerAgent.
        const baseAgent = (typeof pluginConfig?.workerAgent === "string" && pluginConfig.workerAgent) || "dev";
        if ((args?.autonomous || args?.drive) && !runtimeApi) {
          return { ...planned, drive_available: false, note: "subagent runtime not reachable from the plugin in this host — the agent must dispatch each step via its own sessions_spawn tool" };
        }
        if (args?.wave && runtimeApi) {
          // Parallel execute WAVE (--wave): fan out the active phase's PLAN.md units as CONCURRENT executors,
          // each in its own worktree, with SERIALIZED merges (OCT-5). Requires a git repo + an active phase.
          const repoRoot = gsdProjectRoot(process.cwd());
          if (!repoRoot) return { ...planned, wave: true, error: "not a git repo — worktree isolation unavailable" };
          const trackDir = resolveWorkstreamDir(`${repoRoot}/.planning`);
          const phase = routeEngine(trackDir).phase;
          if (!phase) return { ...planned, wave: true, error: "no active phase to fan out" };
          const units = discoverPlanUnits(trackDir, phase);
          if (!units.length) return { ...planned, wave: true, error: `phase ${phase} has no PLAN.md units to run` };
          const result = await runExecuteWave(units, makeUnitDispatcher(runtimeApi as never, intent, repoRoot, baseAgent), { maxConcurrency: 4 });
          return { ...planned, wave: true, phase, allMerged: result.allMerged, failedUnits: result.failedUnits, units: result.units.map((u) => ({ planId: u.unit.planId, status: u.status })) };
        }
        if (args?.autonomous && runtimeApi) {
          // OCT-W5: the FULL multi-phase autonomous loop — re-reads route() per step, advancing on-disk state
          // until the milestone completes (or a real halt/gate/no-progress). Bounded + no-progress-guarded.
          const run = async (agentId: string, message: string) => {
            const res = await runSubagent(runtimeApi as never, agentId, message, { baseAgentId: baseAgent });
            return { ok: res.status === "ok", output: res.text || `[${res.status}]` };
          };
          // /gsd-manager parity: apply the config's manager.flags (per-action default flags) to each dispatch.
          const managerFlags = ((readGsdConfig(".planning").config.manager as { flags?: Record<string, string> })?.flags) ?? {};
          const auto = await runAutonomous(".planning", makeActionDispatcher(run, intent, managerFlags), { autoGates: args?.autoGates === true });
          return { ...planned, autonomous: true, completed: auto.completed, reason: auto.reason, haltedAt: auto.haltedAt, steps: auto.steps };
        }
        if (args?.drive && runtimeApi) {
          // use_worktrees: when the config opts in (and we're in a git repo), isolate code-writing steps in
          // per-plan worktrees (the OCT-5 isolation). Off by default — the config switch now actually gates it.
          const driveCfg = readGsdConfig(".planning").config;
          const useWorktrees = (driveCfg.workflow as { use_worktrees?: boolean })?.use_worktrees === true;
          const repoRoot = gsdProjectRoot(process.cwd());
          const dispatch = makeSubagentDispatcher(runtimeApi as never, intent, baseAgent, useWorktrees && repoRoot ? { worktree: { repoRoot } } : {});
          const run = await executePath(path, dispatch, { autoGates: args?.autoGates === true });
          return {
            ...planned,
            executed: run.steps.map((s) => ({ verb: s.step.verb, status: s.status })),
            completed: run.completed,
            haltedAt: run.haltedAt,
            reason: run.reason,
          };
        }
        return planned;
       } catch (e) {
        // Robustness: a retrieve/executePath/readState rejection returns a clean envelope instead of an
        // unhandled tool-promise rejection (the agent gets a usable error, the turn doesn't abort).
        return { engaged: true, error: e instanceof Error ? e.message : String(e) };
       }
      },
    } as never);

    // RET-07: hybrid retrieval tool (gsd_retrieve). registerTool => ZERO Discord slash slots. Surfaces
    // the long-tail GSD skills/subagents the 6 routers miss (e.g. "the build is flaky" -> gsd-debug) via
    // semantic (spark+LanceDB) + BM25 + trigram, RRF-fused. Degrades to lexical+trigram if spark/vectors absent.
    api.registerTool({
      name: RETRIEVE_TOOL,
      label: "GSD Retrieve",
      description:
        "Retrieve the most relevant GSD skills/subagents for a free-text intent via hybrid semantic+lexical+trigram search. Surfaces long-tail skills the routers miss (e.g. 'the build is flaky' → gsd-debug).",
      parameters: retrieveParams,
      // OpenClaw invokes registerTool execute as (toolCallId, args, signal, onUpdate) — args is the 2nd
      // param (verified against the bundled file-transfer tool + SDK runner). Reading args, NOT the callId.
      async execute(_toolCallId: string, args: { intent?: string; topK?: number }, _signal?: unknown) {
        const intent = (args?.intent ?? "").trim();
        const semantic = embedAvailable(process.env); // false → lexical+trigram only (degraded)
        if (!intent) return { intent: "", semantic, results: [] };
        const docs = await retrieve(intent, { topK: args?.topK ?? 8 });
        // WR-01: semantic was CONFIGURED (embedAvailable) but if no result carries the "semantic" modality it
        // silently fell back to lexical+trigram (spark unreachable) — surface that so the ranking isn't trusted
        // as full-hybrid when it's degraded.
        const degraded = semantic && !docs.some((r) => (r.modalities ?? []).includes("semantic"));
        return {
          intent,
          semantic,
          degraded,
          results: docs.map((r) => ({ id: r.docId, kind: r.kind, title: r.title, score: r.score, modality: r.modalities })),
        };
      },
    } as never);

    // CFG-01: gsd_settings — read/inspect the project's GSD config (workflow toggles + model profile),
    // parity with /gsd-settings + /gsd-config, reimplemented natively (0 Discord slots). When the project
    // has no config yet, `bootstrap:true` writes the canonical GSD defaults (CFG-02; never overwrites).
    api.registerTool({
      name: SETTINGS_TOOL,
      label: "GSD Settings",
      description:
        "Inspect the project's GSD configuration (workflow toggles, model profile, security/review gates) from .planning/config.json, with GSD defaults applied. Pass {bootstrap:true} to write a default config if none exists.",
      parameters: settingsParams,
      async execute(_toolCallId: string, args: { bootstrap?: boolean; profile?: string }, _signal?: unknown) {
        const repoRoot = gsdProjectRoot(process.cwd()) ?? process.cwd();
        let created = false;
        if (args?.bootstrap) created = bootstrapGsdConfig(".planning");
        const { overrides: projectOverrides, source } = readGsdConfig(".planning");
        let config = resolveProfiledConfig(repoRoot, projectOverrides);
        if (args?.profile && isSurfaceProfile(args.profile)) config = applySurfaceProfile(config, args.profile);
        return { source, created, surface: (config.profiles as { surface?: string }).surface, model_profile: config.model_profile, workflow: config.workflow, git: config.git, review: config.review };
      },
    } as never);

    // gsd_command — invoke ANY individual GSD command/skill/workflow by name (not just the 11 backbone verbs),
    // with flags inferred from intent (flags-as-a-layer-of-intent). Opens the full ~88-workflow / 67-skill GSD
    // surface to the agent without a Discord slot. Resolves the command → subagent + flags + workflow guidance.
    api.registerTool({
      name: COMMAND_TOOL,
      label: "GSD Command",
      description:
        "Run a specific GSD command/skill by name (e.g. code-review, debug, secure-phase, docs-update, verify-work) with flags. Flags are inferred from `intent` (e.g. 'review everything' → --all, 'deep audit' → --forensic) and merged with explicit `flags`. Returns the resolving subagent, the merged flags, and the workflow guidance to execute.",
      parameters: commandParams,
      async execute(_toolCallId: string, args: { command?: string; flags?: string; intent?: string }, _signal?: unknown) {
        const command = (args?.command ?? "").trim().replace(/^\/+/, "").replace(/^gsd-/, "");
        if (!command) return { ok: false, error: "command is required" };
        const injection = scanInjection(`${command} ${args?.intent ?? ""} ${args?.flags ?? ""}`);
        const subagent =
          VERB_TO_SUBAGENT[command] ??
          (resolveAgentOptional(`gsd-${command}`) ? `gsd-${command}` : resolveAgentOptional(command) ? command : null);
        const inferred = suggestFlags(args?.intent ?? command, command);
        const explicit = (args?.flags ?? "").split(/\s+/).filter(Boolean);
        const flags = [...new Set([...explicit, ...inferred])];
        let workflow: string | null = null;
        try {
          const hits = await retrieve(`${command} ${args?.intent ?? ""}`.trim(), { topK: 4 });
          workflow =
            hits.find((h) => h.docId.startsWith("workflow:") && h.docId.toLowerCase().includes(command.toLowerCase()))?.docId ??
            hits.find((h) => h.docId.startsWith("workflow:"))?.docId ??
            null;
        } catch {
          /* retrieval degraded — still return the resolution */
        }
        // Cross-AI review: for a review command with review.external configured, resolve the external reviewers
        // (model-ref or ACP harness agentId per the ACP research) and — when the subagent runtime is reachable —
        // dispatch each via runSubagent({model}) and aggregate, then converge (gsd-review --all parity).
        let crossAi: Record<string, unknown> | undefined;
        if (/review/.test(command)) {
          const cfgRoot = gsdProjectRoot(process.cwd());
          const review = (readGsdConfig(cfgRoot ? `${cfgRoot}/.planning` : ".planning").config.review ?? {}) as { external?: string[]; models?: Record<string, string> };
          const external = Array.isArray(review.external) ? review.external : [];
          if (external.length) {
            const reviewers = external.map((e) => resolveReviewer(e, review.models ?? {}));
            const rt = pluginApi?.runtime?.subagent ? pluginApi : null;
            if (rt) {
              const base = (typeof pluginConfig?.workerAgent === "string" && pluginConfig.workerAgent) || "dev";
              const dispatch = async (rv: { id: string; modelRef?: string }): Promise<ReviewFinding[]> => {
                const res = await runSubagent(rt as never, "gsd-code-reviewer", `Cross-AI review (${rv.id}) of the current changes. Report findings with severity HIGH/MEDIUM/LOW. ${args?.intent ?? ""}`, { baseAgentId: base, model: rv.modelRef });
                const sev = /\bhigh\b/i.test(res.text || "") ? "high" : /\bmedium\b/i.test(res.text || "") ? "medium" : "low";
                return res.status === "ok" ? [{ reviewer: rv.id, severity: sev as never, text: (res.text || "").slice(0, 400) }] : [];
              };
              const verdict = await crossAiReview(reviewers, command, dispatch);
              crossAi = { reviewers: reviewers.map((r) => r.id), findings: verdict.findings, high: verdict.highCount, ...(verdict.errored.length ? { errored: verdict.errored } : {}) };
            } else {
              crossAi = { reviewers: reviewers.map((r) => r.id), note: "runtime unreachable — dispatch each reviewer via your own sessions_spawn with its model" };
            }
          }
        }
        return {
          ok: true,
          command,
          subagent,
          flags,
          workflow,
          ...(crossAi ? { cross_ai_review: crossAi } : {}),
          ...(injection.length ? { injection_warning: injection } : {}),
          how_to_run: subagent
            ? `Dispatch the '${subagent}' subagent (your sessions_spawn) with task: "${command}${flags.length ? " " + flags.join(" ") : ""}". The GSD persona is auto-injected by the enforce-gate.`
            : `No mapped subagent — retrieve the workflow '${workflow ?? `workflow:${command}`}' and execute its steps with the flags.`,
        };
      },
    } as never);

    // ENG-WRITE-01: gsd_state — the WRITE half of the engine. Records GSD state advances (status/progress/
    // decisions/blockers) to .planning/STATE.md atomically, so route() runs on LIVE state, not a stale
    // snapshot. Parity with gsd-tools state.* (native, lock-protected). 0 Discord slots.
    api.registerTool({
      name: STATE_TOOL,
      label: "GSD State",
      description:
        "Advance GSD project state in .planning/STATE.md (op: set-status | record-progress | add-decision | add-blocker). Call this as GSD work completes so the route engine sees live state.",
      parameters: stateParams,
      async execute(_toolCallId: string, args: { op?: string; status?: string; decision?: string; blocker?: string; total_plans?: number; completed_plans?: number; total_phases?: number; completed_phases?: number; name?: string; goal?: string; phase?: string; plans?: number; done?: number; req?: string; version?: string; create_repo?: boolean; kind?: string }, _signal?: unknown) {
        // Best-effort project resolution: walk up from cwd to a .planning root. The tool execute context
        // carries NO workspaceDir (SDK limit), so when cwd isn't the workspace (gateway home) this falls
        // back to cwd-relative .planning. The robust state-advance channel is agent_end (workspaceDir) — SDK-03.
        const root = gsdProjectRoot(process.cwd()); // single walk reused below (IN-01)
        const base = root ? `${root}/.planning` : ".planning";
        const dir = resolveWorkstreamDir(base); // operate on the ACTIVE workstream track (or root .planning)
        try {
          switch (args?.op) {
            case "set-status":
              if (!args.status) return { ok: false, error: "set-status requires a non-empty status" };
              setStatus(dir, args.status); break;
            case "record-progress":
              recordProgress(dir, { total_plans: args.total_plans, completed_plans: args.completed_plans, total_phases: args.total_phases, completed_phases: args.completed_phases }); break;
            case "add-decision":
              if (!args.decision) return { ok: false, error: "add-decision requires non-empty decision text" };
              addDecision(dir, args.decision); break;
            case "add-blocker":
              if (!args.blocker) return { ok: false, error: "add-blocker requires non-empty blocker text" };
              addBlocker(dir, args.blocker); break;
            // OCT-W1 write-engine ops (phase/roadmap/milestone/requirements CRUD):
            case "init": {
              fs.mkdirSync(dir, { recursive: true });
              const scaffolded = scaffoldPlanning(dir, { projectName: args.name, description: args.goal });
              let repo;
              if (args.create_repo) {
                const mode = ((readGsdConfig(dir).config.git as { auto_repo?: string })?.auto_repo ?? "private") as RepoMode;
                repo = createAutoRepo(path.dirname(dir), mode, { name: args.name });
              }
              return { ok: true, op: args.op, ...scaffolded, ...(repo ? { repo } : {}) };
            }
            case "progress": return { ok: true, op: args.op, ...buildProgress(dir) };
            case "undo": return { op: args.op, ...undoLast(path.dirname(dir)) };
            case "branch": {
              const git = (readGsdConfig(dir).config.git ?? {}) as Record<string, unknown>;
              return { op: args.op, ...createWorkBranch(path.dirname(dir), git, (args.kind as never) ?? "phase", { phase: args.phase, milestone: args.version, slug: args.name }) };
            }
            case "add-phase": {
              if (!args.name) return { ok: false, error: "add-phase requires a name" };
              const ph = addPhase(dir, args.name, { goal: args.goal });
              return { ok: true, op: args.op, phase: ph.number, planningDir: dir };
            }
            case "scaffold-phase": {
              if (!args.phase || !args.name) return { ok: false, error: "scaffold-phase requires phase + name" };
              const phaseDir = scaffoldPhaseDir(dir, args.phase, args.name);
              // Write the CONTEXT.md stub (route()-parseable) so the scaffolded phase advances discuss→plan instead
              // of sitting empty. Idempotent: never clobber an existing CONTEXT authored by the discuss step.
              const ctxFile = `${phaseDir}/${artifactName(args.phase, "context")}`;
              if (!fs.existsSync(ctxFile)) fs.writeFileSync(ctxFile, contextTemplate(args.phase, args.name));
              return { ok: true, op: args.op, dir: phaseDir, context: ctxFile };
            }
            case "update-plan-progress":
              if (!args.phase || args.plans == null) return { ok: false, error: "update-plan-progress requires phase + plans" };
              return { ok: updatePlanProgress(dir, args.phase, args.plans, args.done), op: args.op };
            case "complete-phase": {
              if (!args.phase) return { ok: false, error: "complete-phase requires phase" };
              // Flow-2 honesty: this marks the ROADMAP **Status:** Complete (display) but route() advances on a
              // PASSED VERIFICATION.md, NOT this line — so the next route() won't move past the phase until the
              // verifier writes one. We do NOT auto-write a PASSED verification here (that would be the unsafe
              // gate-skip): surface the requirement so the caller isn't surprised the loop didn't advance.
              const ok = markPhaseComplete(dir, args.phase);
              const verified = verifyPhaseCompleteness(dir, args.phase).ok;
              return { ok, op: args.op, roadmap_marked: ok, route_will_advance: verified, note: verified ? undefined : "ROADMAP marked Complete, but route() needs a PASSED VERIFICATION.md (run verify-work) before it advances." };
            }
            case "complete-requirement":
              if (!args.req) return { ok: false, error: "complete-requirement requires req" };
              return { ok: markRequirementComplete(dir, args.req), op: args.op };
            case "complete-milestone":
              if (!args.version) return { ok: false, error: "complete-milestone requires version" };
              return { ok: true, op: args.op, ...completeMilestone(dir, args.version) };
            default: return { ok: false, error: `unknown op: ${args?.op}` };
          }
          return { ok: true, op: args.op, planningDir: dir };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    } as never);

    // Workstreams — parallel GSD tracks. Wires src/engine/workstream.ts (was dead code) to a tool + threads
    // resolveWorkstreamDir into gsd_state so state mutations hit the ACTIVE track. 0 Discord slots.
    api.registerTool({
      name: WORKSTREAM_TOOL,
      label: "GSD Workstream",
      description:
        "Manage parallel GSD workstreams (op: list | create | switch | complete | active | suggest). Each is an independent .planning/workstreams/<name>/ track with its own STATE/ROADMAP/phases. 'suggest' maps a coding intent to the track it belongs to (dynamic adoption).",
      parameters: workstreamParams,
      async execute(_toolCallId: string, args: { op?: string; name?: string; intent?: string }, _signal?: unknown) {
        const root = gsdProjectRoot(process.cwd());
        const base = root ? `${root}/.planning` : ".planning";
        try {
          switch (args?.op) {
            case "list": return { ok: true, active: activeWorkstream(base), workstreams: listWorkstreams(base).map((w) => ({ name: w.name, active: w.active, status: w.status })) };
            case "active": return { ok: true, active: activeWorkstream(base) };
            case "create":
              if (!args.name) return { ok: false, error: "create requires a name" };
              return { ok: true, ...createWorkstream(base, args.name) };
            case "switch":
              if (!args.name) return { ok: false, error: "switch requires a name" };
              return { ok: true, active: switchWorkstream(base, args.name) };
            case "complete":
              if (!args.name) return { ok: false, error: "complete requires a name" };
              return { ok: true, ...completeWorkstream(base, args.name) };
            case "suggest":
              return { ok: true, suggested: suggestWorkstream(args.intent ?? "", base) };
            default: return { ok: false, error: `unknown op: ${args?.op}` };
          }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    } as never);

    // OCT-W2: gsd_verify — native integrity engine (the validate-artifacts write-guarantee + verify/validate).
    // The orchestrator can now PRODUCE the integrity verdicts it routes on, not just dispatch a subagent. 0 slots.
    api.registerTool({
      name: VERIFY_TOOL,
      label: "GSD Verify",
      description:
        "Run native GSD integrity checks (op: validate-artifacts | phase-completeness | consistency | health). Returns {ok, defects[]} — validate-artifacts is the write-guarantee gate (an artifact is valid iff route() can drive it).",
      parameters: verifyParams,
      async execute(_toolCallId: string, args: { op?: string; phase?: string }, _signal?: unknown) {
        const root = gsdProjectRoot(process.cwd());
        const base = root ? `${root}/.planning` : ".planning";
        const dir = resolveWorkstreamDir(base);
        try {
          switch (args?.op) {
            case "validate-artifacts": return validateArtifacts(dir);
            case "phase-completeness":
              if (!args.phase) return { ok: false, error: "phase-completeness requires phase" };
              return verifyPhaseCompleteness(dir, args.phase);
            case "consistency": return validateConsistency(dir);
            case "gap": return gapCheck(dir);
            case "uat": return { ok: true, phases: scanUat(dir) };
            case "audit-open": return { ok: true, ...auditOpen(dir) };
            case "health": return validateHealth(dir);
            default: return { ok: false, error: `unknown op: ${args?.op}` };
          }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    } as never);

    // OCT-W3: gsd_session — pause/resume (writes the checkpoint route() halts on) + thread + capture. 0 slots.
    api.registerTool({
      name: SESSION_TOOL,
      label: "GSD Session",
      description: "Session lifecycle (op: pause | resume | thread | threads | close-thread | capture). pause writes the .continue-here.md checkpoint + paused_at so route() halts; resume clears it and returns the handoff.",
      parameters: sessionParams,
      async execute(_id: string, args: { op?: string; reason?: string; next_step?: string; name?: string; content?: string; text?: string; type?: string; options?: unknown }, _sig?: unknown) {
        const root = gsdProjectRoot(process.cwd());
        const base = root ? root + "/.planning" : ".planning";
        const dir = resolveWorkstreamDir(base);
        try {
          switch (args?.op) {
            case "pause":
              if (!args.reason) return { ok: false, error: "pause requires a reason" };
              return { ok: true, ...pauseWork(dir, { reason: args.reason, nextStep: args.next_step }) };
            case "resume": return { ok: true, handoff: resumeWork(dir) };
            case "thread":
              if (!args.name || !args.content) return { ok: false, error: "thread requires name + content" };
              return { ok: true, file: writeThread(dir, args.name, args.content) };
            case "threads": return { ok: true, threads: listThreads(dir) };
            case "close-thread":
              if (!args.name) return { ok: false, error: "close-thread requires name" };
              return { ok: closeThread(dir, args.name) };
            case "capture":
              if (!args.text) return { ok: false, error: "capture requires text" };
              return { ok: capture(dir, args.text, args.type) };
            case "checkpoint": {
              if (!args.text) return { ok: false, error: "checkpoint requires text (the prompt)" };
              const discord = !!(readGsdConfig(dir).config.discord_gates);
              const options = Array.isArray(args.options) ? (args.options as GateOption[]) : undefined;
              const gate = buildCheckpoint(((args.type as CheckpointType) || "decision"), args.text, { options, discord });
              // When discord_gates is on, also hand the agent the exact Discord component payload to send.
              return { ok: true, gate, ...(discord ? { discord: renderCheckpointDiscord(gate) } : {}) };
            }
            case "checkpoint-reply": {
              // Resolve a human's free-text / button reply (content or custom_id 'gsd:<type>:<id>') back to an
              // option id — the routing half of the gate (without it, a shown gate is a dead end).
              if (!args.text || !Array.isArray(args.options)) return { ok: false, error: "checkpoint-reply requires text (the reply) + options (the gate's options)" };
              const reply = args.text.replace(/^gsd:[a-z-]+:/, ""); // accept a raw custom_id too
              const chosen = parseCheckpointReply({ options: args.options as GateOption[] }, reply);
              return { ok: chosen != null, chosen };
            }
            default: return { ok: false, error: "unknown op: " + args?.op };
          }
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
      },
    } as never);

    // OCT-W4: gsd_learnings — cross-project knowledge store (decisions/lessons/patterns). 0 slots.
    api.registerTool({
      name: LEARNINGS_TOOL,
      label: "GSD Learnings",
      description: "Cross-project GSD knowledge store (op: add | query | prune). Captures decisions/lessons/patterns so insight carries across projects.",
      parameters: learningsParams,
      async execute(_id: string, args: { op?: string; kind?: string; text?: string; tags?: string[]; tag?: string; keep?: number }, _sig?: unknown) {
        try {
          switch (args?.op) {
            case "add":
              if (!args.text) return { ok: false, error: "add requires text" };
              return { ok: true, learning: addLearning({ kind: (args.kind as never) ?? "lesson", text: args.text, tags: args.tags }) };
            case "query":
              return { ok: true, results: queryLearnings({ text: args.text, kind: args.kind as never, tag: args.tag }) };
            case "prune":
              return { ok: true, removed: pruneLearnings(args.keep ?? 200) };
            default: return { ok: false, error: "unknown op: " + args?.op };
          }
        } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
      },
    } as never);

    // R0.4 Tier-1: register the 6 namespace router tools (zero Discord slash slots).
    // RTE-01: register the WIRED builder so each router returns the state-aware authoritative
    // next verb (native route('.planning')), not the static substring table (verifier finding).
    for (const router of buildWiredRouterTools(".planning")) {
      api.registerTool(router as never);
    }

    // GATE-05 / D-05: the gate resume interactive handler is PHASE-7 SCAFFOLD — deliberately
    // NOT registered yet (L-04). The two pieces that make it functional — a live pending-gate
    // mirror and the real interaction-time sessionKey — only exist once the gateway round-trip
    // lands (TEST-02). Registering it now with the only values available here (sessionKey:""
    // and an empty-choices pending stub) would produce a handler that ALWAYS default-denies
    // (validateGateChoice false) yet still claims the "gsd-gate" namespace — a no-op handler
    // that could swallow real interactions and mask the absence of a working gate path in
    // integration. We therefore keep registration deferred rather than ship inert live behavior.
    //
    // The plumbing itself is fully unit-proven today (registerGateInteractiveHandler in
    // src/gates/resume.ts, test/gate-resume.test.ts); only the host wiring is gated. Phase 7
    // replaces this block with a registration that passes the live pending gate + the
    // interaction-time sessionKey (and imports registerGateInteractiveHandler then).

    // runSubagent is the code-driven dispatch helper exercised by the orchestrator tool
    // and the loop (Phase 4). Referenced here to keep the wiring explicit.
    void (runSubagent as (api: RunSubagentApi, agentId: string, message: string) => unknown);
  },
});

/**
 * Attach the tool-plugin metadata symbol (OR-1 Option A). `openclaw plugins build` and
 * `validate` read this via `getToolPluginMetadata(entry)`; the `tools[].name` MUST match
 * the `api.registerTool` name above (validate diffs `contracts.tools`).
 */
Object.defineProperty(entry, toolPluginMetadataSymbol, {
  value: {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    activation: { onStartup: true },
    // Declared config LAYER — operators tune GSD-OC through the standard OpenClaw plugin config
    // (plugins.entries.gsd-oc.config). Validated by the host against this schema. The plugin reads these
    // values via pluginConfig; it NEVER writes host config.
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        engageMode: {
          type: "string",
          enum: ["workspace", "intent", "off"],
          default: "workspace",
          description:
            "When to auto-engage GSD: 'workspace' = coding cwd + coding intent (default); 'intent' = coding intent ANYWHERE (no cwd requirement — for non-fixed-dir setups); 'off' = no auto-engage (gsd_* tools still work).",
        },
        codingRoots: {
          type: "array",
          items: { type: "string" },
          default: [],
          description:
            "Extra directories to treat as coding workspaces (in addition to project markers). Supports ~ and $VAR. Use this for code dirs that aren't named codeWS or live elsewhere; multiple dirs allowed.",
        },
        includeDefaultRoot: {
          type: "boolean",
          default: true,
          description: "Include the built-in $HOME/codeWS default root. Set false to rely only on codingRoots + project markers (.git/package.json/etc).",
        },
        workerAgent: {
          type: "string",
          default: "dev",
          description: "Allowlisted base agent that hosts GSD subagent personas when the orchestrator drives.",
        },
        autoEngage: {
          type: "boolean",
          default: true,
          description: "Master switch for auto-engage. false (or engageMode 'off') disables prompt-injection engagement.",
        },
        disabled: {
          type: "boolean",
          default: false,
          description: "Disable GSD-OC engagement entirely (equivalent to engageMode 'off').",
        },
      },
    },
    tools: [
      {
        name: ORCHESTRATE_TOOL,
        label: "GSD Orchestrate",
        description:
          "Route a coding/big-work intent through the GSD lifecycle by dispatching the appropriate GSD subagent.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: RETRIEVE_TOOL,
        label: "GSD Retrieve",
        description:
          "Retrieve relevant GSD skills/subagents for a free-text intent via hybrid retrieval (long-tail aware, 0 slots).",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: SETTINGS_TOOL,
        label: "GSD Settings",
        description: "Inspect/bootstrap the project's GSD configuration (workflow toggles, model profile) — 0 slots.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: COMMAND_TOOL,
        label: "GSD Command",
        description: "Invoke any individual GSD command/skill by name with intent-inferred flags — 0 slots.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: LEARNINGS_TOOL,
        label: "GSD Learnings",
        description: "Cross-project knowledge store (decisions/lessons/patterns) — 0 slots.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: SESSION_TOOL,
        label: "GSD Session",
        description: "Session lifecycle: pause/resume checkpoint + thread + capture — 0 slots.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: VERIFY_TOOL,
        label: "GSD Verify",
        description: "Native GSD integrity checks (validate-artifacts/phase-completeness/consistency/health) — 0 slots.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: WORKSTREAM_TOOL,
        label: "GSD Workstream",
        description: "Manage parallel GSD workstreams (list/create/switch/complete/suggest) — 0 slots.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      {
        name: STATE_TOOL,
        label: "GSD State",
        description: "Advance GSD project state (status/progress/decisions/blockers) in .planning/STATE.md — 0 slots.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
      ...routerMetadataTools(),
    ],
  },
  enumerable: false,
});

export default entry;
