import { Type } from "typebox";

/**
 * R0.4 Tier-1 namespace routers. Six router tools front the ~200 concrete GSD verbs so
 * ZERO Discord global slash-command slots are consumed (the long tail is reached via
 * toolSearch — Tier 2). Mirrors opengsd v1.40's "6 routers front 86 skills".
 *
 * Each router returns the candidate concrete verbs for its namespace. The AUTHORITATIVE
 * next verb (state-aware) is computed by the native route engine in Phase 2; until then
 * routers expose the namespace's verb table + a lightweight intent match.
 */

export type RouterDef = {
  name: string;
  namespace: string;
  description: string;
  verbs: string[];
};

export const ROUTERS: RouterDef[] = [
  {
    name: "gsd_workflow",
    namespace: "workflow",
    description:
      "Route phase-pipeline intent (discuss/plan/execute/verify/phase/progress) to the next GSD action.",
    verbs: ["discuss", "plan", "execute", "verify", "phase", "progress"],
  },
  {
    name: "gsd_project",
    namespace: "project",
    description: "Route project-lifecycle intent (milestones/audits/summary).",
    verbs: ["new-milestone", "complete-milestone", "audit-milestone", "milestone-summary", "stats"],
  },
  {
    name: "gsd_quality",
    namespace: "quality",
    description: "Route quality-gate intent (code-review/debug/audit/security/eval/ui).",
    verbs: ["code-review", "debug", "audit-uat", "secure-phase", "eval-review", "ui-review"],
  },
  {
    name: "gsd_context",
    namespace: "context",
    description: "Route codebase-intelligence intent (map/graphify/docs/learnings).",
    verbs: ["map-codebase", "graphify", "docs-update", "extract-learnings"],
  },
  {
    name: "gsd_manage",
    namespace: "manage",
    description: "Route management intent (config/workspace/workstreams/thread/update/ship/inbox).",
    verbs: ["config", "workspace", "workstreams", "thread", "update", "ship", "inbox"],
  },
  {
    name: "gsd_ideate",
    namespace: "ideate",
    description: "Route exploration/capture intent (explore/sketch/spike/spec/capture).",
    verbs: ["explore", "sketch", "spike", "spec-phase", "capture"],
  },
];

export type RouteHit = {
  namespace: string;
  candidates: string[];
  matched: string | null;
  note: string;
};

/** Lightweight intent → verb match within a namespace (substring/keyword). */
export function routeIntent(def: RouterDef, intent?: string): RouteHit {
  const matched =
    intent && intent.trim()
      ? def.verbs.find((v) => {
          const i = intent.toLowerCase();
          return i.includes(v) || v.split("-").some((part) => part.length > 3 && i.includes(part));
        }) ?? null
      : null;
  return {
    namespace: def.namespace,
    candidates: def.verbs,
    matched,
    note:
      "Phase-2 native route engine returns the authoritative state-aware next verb; this is the namespace verb table.",
  };
}

/** Build the 6 router tool descriptors (shape consumable by api.registerTool). */
export function buildRouterTools() {
  return ROUTERS.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: Type.Object(
      { intent: Type.Optional(Type.String({ description: "Freeform intent to route." })) },
      { additionalProperties: false },
    ),
    execute: async (params: { intent?: string }): Promise<RouteHit> => routeIntent(def, params?.intent),
  }));
}

/** Tool-plugin metadata `tools[]` entries for the 6 routers (names must match registerTool). */
export function routerMetadataTools() {
  return ROUTERS.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: { type: "object", additionalProperties: false, properties: {} },
  }));
}
