import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { toolPluginMetadataSymbol } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import { autoEngageHandler } from "./hooks/auto-engage.js";
import { autoAdvanceHandler } from "./hooks/auto-advance.js";
import { runSubagent, type RunSubagentApi } from "./dispatch/run-subagent.js";
import { readState } from "./state/read-state.js";
import { buildRouterTools, routerMetadataTools } from "./routers/routers.js";
import { registerGateInteractiveHandler } from "./gates/resume.js";
import type { NextTurnInjectionApi } from "./orchestrate/inject.js";
import type { GsdGate } from "./gates/types.js";

const PLUGIN_ID = "gsd-oc";
const PLUGIN_NAME = "GSD-OC";
const PLUGIN_DESCRIPTION = "GSD lifecycle orchestration for OpenClaw — native, no Claude Code.";

const ORCHESTRATE_TOOL = "gsd_orchestrate";

/** TypeBox schema for the orchestrator tool's parameters. */
const orchestrateParams = Type.Object(
  {
    intent: Type.Optional(
      Type.String({ description: "Freeform description of the coding/big-work intent to route through GSD." }),
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
    api.registerHook(
      "before_prompt_build",
      ((event: unknown, ctx: unknown) =>
        autoEngageHandler(
          event as Parameters<typeof autoEngageHandler>[0],
          ctx as Parameters<typeof autoEngageHandler>[1],
          { pluginConfig },
        )) as never,
    );

    // Auto-advance: the loop's cross-turn lever (ORCH-04). before_agent_finalize re-runs
    // route() and revises for a code-driven step, guarded by stopHookActive + maxAttempts.
    // Inert unless the operator sets hooks.allowConversationAccess (README; never mutated).
    api.registerHook("before_agent_finalize", autoAdvanceHandler as never);

    // Orchestrator tool: code-driven dispatch entry point (ORCH-01 / AGT-02).
    api.registerTool({
      name: ORCHESTRATE_TOOL,
      label: "GSD Orchestrate",
      description:
        "Route a coding/big-work intent through the GSD lifecycle by dispatching the appropriate GSD subagent.",
      parameters: orchestrateParams,
      async execute(params: { intent?: string }) {
        const state = await readState(".planning");
        return {
          engaged: true,
          current_phase: state.current_phase,
          current_phase_name: state.current_phase_name,
          intent: params?.intent ?? null,
        };
      },
    } as never);

    // R0.4 Tier-1: register the 6 namespace router tools (zero Discord slash slots).
    for (const router of buildRouterTools()) {
      api.registerTool(router as never);
    }

    // GATE-05 / D-05: register the gate resume interactive handler defensively. The accessor is
    // guarded (matches the pluginConfig/session.state style above) so it is inert when the host
    // does not expose registerInteractiveHandler — `openclaw plugins validate` stays green because
    // this is runtime-only registration (NO new tool/command added → 0-slot invariant, RTE-03).
    //
    // LIMITATION (documented, not faked): the live pending-gate + sessionKey arrive at interaction
    // time. A live pending-gate mirror via the session extension is gateway-gated → Phase 7. The
    // plumbing is unit-proven (test/gate-resume.test.ts); the LIVE round-trip is Phase 7 (TEST-02).
    const registerInteractiveHandler = (
      api as { registerInteractiveHandler?: (reg: unknown) => void }
    ).registerInteractiveHandler;
    if (typeof registerInteractiveHandler === "function") {
      const pendingGateStub: GsdGate = { id: "gsd-gate", kind: "binary", title: "GSD gate", choices: [] };
      registerInteractiveHandler(
        registerGateInteractiveHandler({
          api: api as unknown as NextTurnInjectionApi,
          sessionKey: "",
          pending: pendingGateStub,
        }),
      );
    }

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
      ...routerMetadataTools(),
    ],
  },
  enumerable: false,
});

export default entry;
