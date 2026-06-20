/**
 * PATH-01: the finite-path orchestrator core. Turns a free-text intent + the skills/subagents that
 * gsd_retrieve surfaced for it into an ORDERED GSD lifecycle path — the core backbone
 * (discuss→map→plan→execute→code-review→verify→ship) plus conditional long-tail stages (ui / ai-eval /
 * debug / secure / spike / graphify) activated by what retrieval found, NOT a static table. This is the
 * "what should happen" plan; the live position within it comes from route() over .planning/ state.
 */

export interface PathStep {
  verb: string;
  skill: string;
  /** why this step is in the path (core backbone, or the retrieval signal that activated it) */
  reason: string;
  /** true for decision-gate steps that require an interactive discussion / approval (ENF-01) */
  gate: boolean;
}

interface Stage {
  verb: string;
  skill: string;
  pos: number;
  gate?: boolean;
  reason?: string;
}

/** Core lifecycle backbone — always present, in canonical order. */
const BACKBONE: Stage[] = [
  { verb: "discuss", skill: "gsd-discuss-phase", pos: 10, gate: true, reason: "core: gather context + decisions (gate)" },
  { verb: "map-codebase", skill: "gsd-map-codebase", pos: 20, reason: "core: map existing code before planning" },
  { verb: "plan", skill: "gsd-plan-phase", pos: 40, gate: true, reason: "core: research + plan (gate)" },
  { verb: "execute", skill: "gsd-execute-phase", pos: 60, reason: "core: implement the plan" },
  { verb: "code-review", skill: "gsd-code-review", pos: 70, reason: "core: review changed code (ENF-05)" },
  { verb: "verify", skill: "gsd-verify-work", pos: 80, gate: true, reason: "core: goal-backward verification (gate)" },
  { verb: "ship", skill: "gsd-ship", pos: 90, reason: "core: PR + ship" },
];

/** Conditional long-tail stages, activated when retrieval surfaces a matching doc category. */
const CONDITIONAL: { match: RegExp; stage: Stage }[] = [
  { match: /spike/, stage: { verb: "spike", skill: "gsd-spike", pos: 25, reason: "retrieval: risky/unknown approach — spike first" } },
  { match: /(^|:)ui-|ui-phase|sketch|frontend/, stage: { verb: "ui", skill: "gsd-ui-phase", pos: 30, gate: true, reason: "retrieval: frontend work — UI design contract" } },
  { match: /eval|ai-integration|ai-spec|domain-research|framework-select/, stage: { verb: "ai-integration", skill: "gsd-ai-integration-phase", pos: 35, gate: true, reason: "retrieval: AI system — spec + eval strategy" } },
  { match: /debug|debugger/, stage: { verb: "debug", skill: "gsd-debug", pos: 55, reason: "retrieval: bug/failure intent — systematic debug" } },
  { match: /secure|security/, stage: { verb: "secure", skill: "gsd-secure-phase", pos: 65, reason: "retrieval: security-sensitive — threat model" } },
  { match: /graphify|knowledge-graph/, stage: { verb: "graphify", skill: "gsd-graphify", pos: 85, reason: "retrieval: knowledge-graph request" } },
];

export interface SelectPathInput {
  intent: string;
  /** the doc ids gsd_retrieve surfaced for this intent (e.g. "workflow:debug", "agent:gsd-ui-checker") */
  retrieved: { docId: string }[];
}

/**
 * Build the ordered finite path for an intent. The backbone is always present; conditional stages are
 * inserted iff retrieval surfaced their category — so the path is driven by what's actually relevant to
 * THIS intent, not a fixed list. Steps are returned in lifecycle order.
 */
export function selectPath(input: SelectPathInput): PathStep[] {
  const ids = input.retrieved.map((r) => r.docId.toLowerCase());
  const stages: Stage[] = [...BACKBONE];
  for (const c of CONDITIONAL) {
    if (ids.some((id) => c.match.test(id))) stages.push(c.stage);
  }
  stages.sort((a, b) => a.pos - b.pos);
  return stages.map((s) => ({ verb: s.verb, skill: s.skill, reason: s.reason ?? "core lifecycle", gate: s.gate ?? false }));
}
