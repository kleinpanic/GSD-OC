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
  { verb: "research", skill: "gsd-plan-phase --research", pos: 30, reason: "core: research-first — investigate domain/APIs before planning (ENF-02)" },
  { verb: "plan", skill: "gsd-plan-phase", pos: 40, gate: true, reason: "core: plan from research + context (gate)" },
  { verb: "execute", skill: "gsd-execute-phase", pos: 60, reason: "core: implement the plan" },
  { verb: "code-review", skill: "gsd-code-review", pos: 70, reason: "core: review changed code (ENF-05)" },
  { verb: "verify", skill: "gsd-verify-work", pos: 80, gate: true, reason: "core: goal-backward verification (gate)" },
  { verb: "ship", skill: "gsd-ship", pos: 90, reason: "core: PR + ship" },
];

/**
 * Conditional long-tail stages. Each activates on EITHER (a) the intent text matching the category's
 * keywords (precise — the dominant signal), OR (b) a matching doc appearing in retrieval's TOP-2 (a
 * strong semantic backstop for intents whose words don't name the category, e.g. "the build is flaky"
 * → debug). The old "match anywhere in top-12" gate was too loose — the small fuzzy corpus surfaced
 * debug/spike/ui docs in nearly every intent's tail, inserting spurious stages (measured 5/8 false+).
 */
// A conditional fires on EITHER the intent keywords (precise) OR retrieval CONSENSUS — the category
// appearing in ≥CONSENSUS_MIN of the top-CONSENSUS_TOP retrieved docs. Consensus (not a single top hit)
// is the retrieval-driven signal (PATH-01) that stays noise-free: the small fuzzy corpus puts a lone
// debug/ui doc in many tails, but rarely two of one category in the top-5 unless it's genuinely relevant.
const CONSENSUS_TOP = 5;
const CONSENSUS_MIN = 2;
const CONDITIONAL: { intent: RegExp; doc: RegExp; stage: Stage }[] = [
  { intent: /\b(spike|prototype|poc|proof of concept|experiment|risky|de-?risk|unknown approach|explore)\b/, doc: /spike/, stage: { verb: "spike", skill: "gsd-spike", pos: 25, reason: "risky/unknown approach — spike first" } },
  { intent: /\b(ui|frontend|front-end|react|vue|svelte|component|css|layout|dashboard|screen|page|mockup|sketch|design|button|form|modal)\b/, doc: /(^|:)ui-|ui-phase|sketch|frontend/, stage: { verb: "ui", skill: "gsd-ui-phase", pos: 30, gate: true, reason: "frontend work — UI design contract" } },
  { intent: /\b(ai|a\.i\.|llm|agent|embedding|eval\w*|model|gpt|chatbot|rag|prompt|inference|fine-?tune)\b/, doc: /eval|ai-integration|ai-spec|domain-research|framework-select/, stage: { verb: "ai-integration", skill: "gsd-ai-integration-phase", pos: 35, gate: true, reason: "AI system — spec + eval strategy" } },
  { intent: /\b(bug|debug\w*|flaky|fail\w*|broken|crash\w*|error|reproduce|intermittent|stack ?trace|regression)\b/, doc: /debug|debugger/, stage: { verb: "debug", skill: "gsd-debug", pos: 55, reason: "bug/failure intent — systematic debug" } },
  { intent: /\b(secur\w*|vulnerab\w*|threat\w*|exploit\w*|csrf|xss|inject\w*|mitigat\w*|pentest|owasp|cve|auth\w*)\b/, doc: /secure|security/, stage: { verb: "secure", skill: "gsd-secure-phase", pos: 65, reason: "security-sensitive — threat model" } },
  { intent: /\b(graph\w*|knowledge graph)\b/, doc: /graphify|knowledge-graph/, stage: { verb: "graphify", skill: "gsd-graphify", pos: 85, reason: "knowledge-graph request" } },
  { intent: /\b(document\w*|readme|changelog|api docs|docstring)\b/, doc: /doc-writer|docs-update|documentation/, stage: { verb: "docs", skill: "gsd-docs-update", pos: 88, reason: "documentation request — write/verify docs" } },
];

export interface SelectPathInput {
  intent: string;
  /** the doc ids gsd_retrieve surfaced for this intent, IN RANK ORDER (top first). */
  retrieved: { docId: string }[];
}

/**
 * Build the ordered finite path for an intent. The backbone is always present; a conditional stage is
 * inserted iff its intent-keyword or top-2 retrieval signal fires — driven by what's actually relevant
 * to THIS intent, not a fixed list, and not by loose retrieval noise. Steps are returned in lifecycle order.
 */
export function selectPath(input: SelectPathInput): PathStep[] {
  const intent = input.intent.toLowerCase();
  const topIds = input.retrieved.slice(0, CONSENSUS_TOP).map((r) => r.docId.toLowerCase());
  const stages: Stage[] = [...BACKBONE];
  for (const c of CONDITIONAL) {
    const consensus = topIds.filter((id) => c.doc.test(id)).length >= CONSENSUS_MIN;
    if (c.intent.test(intent) || consensus) stages.push(c.stage);
  }
  stages.sort((a, b) => a.pos - b.pos);
  return stages.map((s) => ({ verb: s.verb, skill: s.skill, reason: s.reason ?? "core lifecycle", gate: s.gate ?? false }));
}
