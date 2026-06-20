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

const PLUGIN_ID = "gsd-oc";
const PLUGIN_NAME = "GSD-OC";
const PLUGIN_DESCRIPTION = "GSD lifecycle orchestration for OpenClaw — native, no Claude Code.";

const ORCHESTRATE_TOOL = "gsd_orchestrate";
const RETRIEVE_TOOL = "gsd_retrieve";

/** TypeBox schema for the orchestrator tool's parameters. */
const orchestrateParams = Type.Object(
  {
    intent: Type.Optional(
      Type.String({ description: "Freeform description of the coding/big-work intent to route through GSD." }),
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
      async execute(_toolCallId: string, args: { intent?: string }, _signal?: unknown) {
        const state = await readState(".planning");
        return {
          engaged: true,
          current_phase: state.current_phase,
          current_phase_name: state.current_phase_name,
          intent: args?.intent ?? null,
        };
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
        if (!intent) return { intent: "", results: [] };
        const docs = await retrieve(intent, { topK: args?.topK ?? 8 });
        return { intent, results: docs.map((r) => ({ id: r.docId, kind: r.kind, title: r.title, score: r.score })) };
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
      ...routerMetadataTools(),
    ],
  },
  enumerable: false,
});

export default entry;
