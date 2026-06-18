import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { toolPluginMetadataSymbol } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import { autoEngageHandler } from "./hooks/auto-engage.js";
import { autoAdvanceHandler } from "./hooks/auto-advance.js";
import { runSubagent, type RunSubagentApi } from "./dispatch/run-subagent.js";
import { readState } from "./state/read-state.js";
import { buildRouterTools, routerMetadataTools } from "./routers/routers.js";

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

    // Auto-engage: inject the GSD meta-prompt for coding-workspace turns (ENG-02).
    // Uses api.registerHook (NOT api.on — api.on does not exist on the installed SDK).
    api.registerHook("before_prompt_build", autoEngageHandler as never);

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
