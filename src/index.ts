import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { toolPluginMetadataSymbol } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
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
import { enforceToolGate } from "./hooks/enforce-gate.js";
import { setStatus, recordProgress, addDecision, addBlocker } from "./engine/mutate.js";
import { executePath, makeSubagentDispatcher } from "./orchestrate/execute-path.js";

const PLUGIN_ID = "gsd-oc";
const PLUGIN_NAME = "GSD-OC";
const PLUGIN_DESCRIPTION = "GSD lifecycle orchestration for OpenClaw — native, no Claude Code.";

const ORCHESTRATE_TOOL = "gsd_orchestrate";
const RETRIEVE_TOOL = "gsd_retrieve";
const SETTINGS_TOOL = "gsd_settings";
const STATE_TOOL = "gsd_state";

/** TypeBox schema for the gsd_state mutation tool (ENG-WRITE-01). */
const stateParams = Type.Object(
  {
    op: Type.String({ description: "Mutation: 'set-status' | 'record-progress' | 'add-decision' | 'add-blocker'." }),
    status: Type.Optional(Type.String({ description: "For set-status (e.g. planning|executing|complete|error)." })),
    decision: Type.Optional(Type.String({ description: "For add-decision: the decision text." })),
    blocker: Type.Optional(Type.String({ description: "For add-blocker: the blocker text." })),
    total_plans: Type.Optional(Type.Number()),
    completed_plans: Type.Optional(Type.Number()),
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
      ((event: unknown, ctx: unknown) =>
        enforceToolGate(
          event as Parameters<typeof enforceToolGate>[0],
          ctx as Parameters<typeof enforceToolGate>[1],
          { pluginConfig },
        )) as never,
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
        args: { intent?: string; drive?: boolean; autoGates?: boolean },
        _signal?: unknown,
        _onUpdate?: unknown,
        context?: { api?: unknown },
      ) {
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
        // Diagnostic: report whether the in-plugin subagent runtime is reachable (drives are only possible when true).
        if (args?.drive && !runtimeApi) {
          return { ...planned, drive_available: false, note: "subagent runtime not reachable from the plugin in this host — the agent must dispatch each path step via its own sessions_spawn tool" };
        }
        if (args?.drive && runtimeApi) {
          // GSD personas must run under a real allowlisted agent (subagents.allowAgents). Default "dev" —
          // present in every primary agent's allowlist; operator-overridable via pluginConfig.workerAgent.
          const baseAgent = (typeof pluginConfig?.workerAgent === "string" && pluginConfig.workerAgent) || "dev";
          const dispatch = makeSubagentDispatcher(runtimeApi as never, intent, baseAgent);
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
        return {
          intent,
          semantic,
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
      async execute(_toolCallId: string, args: { bootstrap?: boolean }, _signal?: unknown) {
        let created = false;
        if (args?.bootstrap) created = bootstrapGsdConfig(".planning");
        const { config, source } = readGsdConfig(".planning");
        return { source, created, model_profile: config.model_profile, workflow: config.workflow, git: config.git };
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
      async execute(_toolCallId: string, args: { op?: string; status?: string; decision?: string; blocker?: string; total_plans?: number; completed_plans?: number }, _signal?: unknown) {
        const dir = ".planning";
        try {
          switch (args?.op) {
            case "set-status": if (args.status) setStatus(dir, args.status); break;
            case "record-progress": recordProgress(dir, { total_plans: args.total_plans, completed_plans: args.completed_plans }); break;
            case "add-decision": if (args.decision) addDecision(dir, args.decision); break;
            case "add-blocker": if (args.blocker) addBlocker(dir, args.blocker); break;
            default: return { ok: false, error: `unknown op: ${args?.op}` };
          }
          return { ok: true, op: args.op };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
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
    configSchema: { type: "object", additionalProperties: false, properties: {} },
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
