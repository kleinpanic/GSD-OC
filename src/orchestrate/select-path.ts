/**
 * PATH-01: the finite-path orchestrator core. Turns a free-text intent + the skills/subagents that
 * gsd_retrieve surfaced for it into an ORDERED GSD lifecycle path — the core backbone
 * (discuss→map→plan→execute→code-review→verify→ship) plus conditional long-tail stages (ui / ai-eval /
 * debug / secure / spike / graphify) activated by what retrieval found, NOT a static table. This is the
 * "what should happen" plan; the live position within it comes from route() over .planning/ state.
 *
 * Complexity-tiered (gsd-quick parity): a "quick" intent (add/rename/tweak/fix a small thing) gets a
 * MINIMAL path — not the full lifecycle — so trivial work isn't over-orchestrated and a driven run
 * completes fast. Substantial work (build/refactor/migrate/new-project) gets the full backbone.
 */
import { classifyIntent } from "../engage/classify.js";

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

/** Full lifecycle backbone for substantial work (build/refactor/migrate/new-project). */
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
 * Minimal path for a "quick" intent (gsd-quick parity): a small, specific, actionable task — execute it
 * with GSD guarantees (atomic commit, verify) but skip discuss/map/research/plan/ship. Conditional
 * long-tail stages (debug/secure/ui…) still apply if the intent strongly signals them.
 */
const QUICK_BACKBONE: Stage[] = [
  { verb: "execute", skill: "gsd-quick", pos: 60, reason: "quick: small actionable task — execute with GSD guarantees (atomic commit)" },
  { verb: "verify", skill: "gsd-verify-work", pos: 80, reason: "quick: lightweight verification of the change" },
];

/** Intent categories (from classifyIntent) that take the minimal QUICK path instead of the full backbone. */
const QUICK_CATEGORIES = new Set(["quick"]);

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
// `doc` matches ONLY `workflow:` docs for the category — never agent ids. Keying consensus on agent-name
// substrings let generic agents (gsd-domain-researcher, gsd-eval-auditor) falsely vote for ai-integration
// and insert its HALTING gate (review HIGH-1). Workflow-doc consensus is a rare, genuine signal; keywords
// carry the precise activation.
const CONDITIONAL: { intent: RegExp; doc: RegExp; stage: Stage }[] = [
  { intent: /\b(spike|prototype|poc|proof of concept|experiment|risky|de-?risk|unknown approach|explore)\b/, doc: /^workflow:spike/, stage: { verb: "spike", skill: "gsd-spike", pos: 25, reason: "risky/unknown approach — spike first" } },
  { intent: /\b(ui|frontend|front-end|react|vue|svelte|component|css|layout|dashboard|screen|page|mockup|sketch|design|button|form|modal)\b/, doc: /^workflow:(ui-phase|ui-review|sketch)/, stage: { verb: "ui", skill: "gsd-ui-phase", pos: 30, gate: true, reason: "frontend work — UI design contract" } },
  { intent: /\b(ai|a\.i\.|llm|agent|embedding\w*|eval\w*|model|gpt|chatbot|rag|prompt|inference|fine-?tune|spark|dgx|nim|gpu|cuda|h100|a100)\b/, doc: /^workflow:(ai-integration|eval-review)/, stage: { verb: "ai-integration", skill: "gsd-ai-integration-phase", pos: 35, gate: true, reason: "AI/ML system (incl. spark/DGX) — spec + eval strategy" } },
  { intent: /\b(integrat\w*|end-to-end|e2e|cross-phase|wire up|connect (the )?phases?)\b/, doc: /^workflow:(verify-phase|integration)/, stage: { verb: "integration", skill: "gsd-integration-checker", pos: 82, reason: "cross-phase/E2E — integration check" } },
  { intent: /\b(bug|debug\w*|flaky|fail\w*|broken|crash\w*|error|reproduce|intermittent|stack ?trace|regression)\b/, doc: /^workflow:debug/, stage: { verb: "debug", skill: "gsd-debug", pos: 55, reason: "bug/failure intent — systematic debug" } },
  // BL-01: cover embedded-auth + credential vocabulary. `\bauth\w*\b` misses "OAuth" (no boundary before
  // "auth") and "password reset" etc. Added oauth/jwt/login/password/credential/sso/saml/rbac/encrypt — the
  // clearly-security terms; deliberately NOT the generic session/token/permission (too many false positives).
  { intent: /\b(secur\w*|vulnerab\w*|threat\w*|exploit\w*|csrf|xss|inject\w*|mitigat\w*|pentest|owasp|cve|auth\w*|oauth|jwt|login|logout|password|credential\w*|sso|saml|rbac|encrypt\w*|decrypt\w*)\b/, doc: /^workflow:secure/, stage: { verb: "secure", skill: "gsd-secure-phase", pos: 65, reason: "security-sensitive — threat model" } },
  { intent: /\b(graph\w*|knowledge graph)\b/, doc: /^(workflow|reference):graphify/ /* keyword-carried; no top-level workflow:graphify exists */, stage: { verb: "graphify", skill: "gsd-graphify", pos: 85, reason: "knowledge-graph request" } },
  { intent: /\b(document\w*|readme|changelog|api docs|docstring)\b/, doc: /^workflow:docs-update/, stage: { verb: "docs", skill: "gsd-docs-update", pos: 88, reason: "documentation request — write/verify docs" } },
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
  // WR-01: an empty/whitespace or non-engaging (chat) intent is not GSD work — no path to drive.
  // classifyIntent("") → chat, which is NOT quick, so it would otherwise fall through to the full
  // backbone. Return an empty path so callers (and executePath) can distinguish "nothing to do".
  if (input.intent.trim().length === 0) return [];
  const intent = input.intent.slice(0, 8192).toLowerCase(); // L-2: bound regex work on the intent
  const topIds = input.retrieved.slice(0, CONSENSUS_TOP).map((r) => r.docId.toLowerCase());
  // Complexity tier: a "quick" intent gets the minimal path; substantial work gets the full backbone.
  const category = classifyIntent(input.intent).category;
  if (category === "chat") return [];
  const isQuick = QUICK_CATEGORIES.has(category);
  const stages: Stage[] = [...(isQuick ? QUICK_BACKBONE : BACKBONE)];
  for (const c of CONDITIONAL) {
    const consensus = topIds.filter((id) => c.doc.test(id)).length >= CONSENSUS_MIN;
    if (c.intent.test(intent) || consensus) {
      // BLOCKER #3: a QUICK path must not drag in a HEAVY GATED conditional (the UI design-contract / AI-eval
      // gates). The old code stripped the gate and inserted the stage anyway — turning the gate into a silent
      // no-op AND inflating a quick task with substantial lifecycle work. A quick task that genuinely needs the
      // UI/AI contract isn't quick. So on the quick path, SKIP gated conditionals entirely; non-gated long-tail
      // stages (debug/secure/docs/graphify) are legit small additions and still apply.
      if (isQuick && c.stage.gate) continue;
      stages.push(c.stage);
    }
  }
  // WR-04: deterministic ordering. pos collisions (research/ui both pos 30) must not rely on V8
  // sort stability — break ties by verb so output is reproducible.
  stages.sort((a, b) => a.pos - b.pos || a.verb.localeCompare(b.verb));
  return stages.map((s) => ({ verb: s.verb, skill: s.skill, reason: s.reason ?? "core lifecycle", gate: s.gate ?? false }));
}
