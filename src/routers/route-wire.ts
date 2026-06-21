import { Type } from "typebox";
import { route, type RouteResult } from "../engine/route.js";
import { ROUTERS, type RouterDef } from "./routers.js";
import { resolveWorkstreamDir } from "../engine/workstream.js";
import { gsdProjectRoot } from "../hooks/enforce-gate.js";

/**
 * RTE-01 / D-01: wire each namespace router's `execute` to the native `route(".planning")`
 * engine so it returns the AUTHORITATIVE state-aware next verb (6-RESEARCH.md:96-102, :298),
 * not the static substring match from `routeIntent`.
 *
 * route() is the Phase-2 pure, read-only engine (src/engine/route.ts). The wired adapter
 * maps its RouteResult → a bounded { namespace, next_verb, reason, args } envelope. Halt
 * results (hard-stop gates) surface as { next_verb:"halt", reason } and never throw.
 *
 * `routeIntent` (src/routers/routers.ts) remains the documented static fallback; this is the
 * primary, authoritative path now that route() is merged (OR-R1e).
 */

export type WiredRouteHit = {
  namespace: string;
  next_verb: string;
  reason: string;
  args: { phase?: string };
};

/** Map a RouteResult → the bounded wired envelope for a given router namespace. */
function mapRouteResult(namespace: string, result: RouteResult): WiredRouteHit {
  return {
    namespace,
    next_verb: result.action,
    reason: result.reason,
    args: result.phase ? { phase: result.phase } : {},
  };
}

/**
 * Build an async `execute` for a router that calls the authoritative route() engine.
 * `intent` is accepted for descriptor-shape parity but route() is state-driven, not
 * intent-driven — the authoritative next verb is a function of `.planning/` on disk.
 */
export function wireRouterExecute(
  def: RouterDef,
  planningDir = ".planning",
): (params?: { intent?: string }) => Promise<WiredRouteHit> {
  return async (_params?: { intent?: string }): Promise<WiredRouteHit> => {
    // Flow-5: route over the same track gsd_state mutates. For the default, walk UP from cwd to the GSD project
    // root (matching gsd_state + enforce-gate, which use gsdProjectRoot) before resolving the active workstream —
    // so all three agree on WHICH project even when cwd is the gateway home, not the project dir. Explicit dir honored.
    const base =
      planningDir === ".planning"
        ? resolveWorkstreamDir(`${gsdProjectRoot(process.cwd()) ?? process.cwd()}/.planning`)
        : planningDir;
    return mapRouteResult(def.namespace, route(base));
  };
}

/**
 * Build the 6 router tool descriptors with `execute` wired to route(). Mirrors
 * `buildRouterTools()` shape (name/label/description/parameters) but swaps execute for the
 * authoritative adapter. Descriptor fields are reused from ROUTERS — not re-declared.
 */
export function buildWiredRouterTools(planningDir = ".planning") {
  return ROUTERS.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: Type.Object(
      { intent: Type.Optional(Type.String({ description: "Freeform intent to route." })) },
      { additionalProperties: false },
    ),
    execute: wireRouterExecute(def, planningDir),
  }));
}
