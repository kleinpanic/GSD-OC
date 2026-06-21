<!-- generated-by: gsd-doc-writer -->
# GSD Subagents

GSD-OC ships **33 GSD subagents** — the GSD methodology personas ported from the
upstream `gsd-core` agents and adapted to run natively under OpenClaw, with no Claude
Code in the loop. Each subagent is a persona prompt plus an effort tier and a model
tier; the orchestrator dispatches them in the right order as it drives a finite GSD path.

This document describes what the 33 subagents are, how they are dispatched, and how
the model for each is resolved. It is grounded in the committed roster and engine code
— it does not invent agents.

## What a GSD subagent is

A subagent is an `AgentDefinition` record [REF: src/agents/types.ts:11-19]:

```ts
type AgentDefinition = {
  id: string;
  name: string;
  description: string;
  prompt: string;                 // persona — injected at dispatch
  tools: { allow: string[]; deny?: string[] };
  thinking: "low" | "high" | "xhigh";   // effort/lane tier
  model?: string;
};
```

The 33 records live in `src/agents/roster.generated.ts` — a **generated** file
(`scripts/port-agents.ts`), never hand-edited [REF: src/agents/roster.generated.ts:1-6].
The source agents are the snapshotted `gsd-*.md` personas; the generator emits the
committed `ROSTER` array of 33 entries.

Each agent carries three things that matter at dispatch:

- **persona prompt** (`prompt`) — injected per-call as the subagent's system prompt.
- **effort tier** (`thinking`: `low` / `high` / `xhigh`) — carried into the run as the
  `lane` selector (1:1 with the thinking tier) [REF: src/dispatch/run-subagent.ts:142].
- **model tier** — resolved separately from the model catalog under the project's
  `model_profile` (see [Model routing](#model-routing)).

### PORT-01: runtime-agnostic adaptation

The upstream personas were written **for Claude Code** — they instruct the agent to read
`$HOME/.claude/gsd-core/...` files and shell a `gsd-tools` CLI, neither of which exists
under OpenClaw [REF: scripts/adapt-gsd.ts:2-7]. The PORT-01 build-time transform
(`adaptGsdText`) rewrites those Claude-runtime assumptions into runtime-agnostic language
before the persona is committed to the roster [REF: scripts/port-agents.ts:86]. Among the
rewrites [REF: scripts/adapt-gsd.ts:16-39]:

- `$HOME/.claude/gsd-core/references/X.md` → a bundled GSD reference retrievable via
  `gsd_retrieve`.
- `$HOME/.claude/.../bin/...` and `gsd-tools.cjs` → the neutral `gsd-oc-engine`.
- `Claude Code` → `the OpenClaw agent`; `claude-code` → `openclaw`.

A `hasClaudeRuntimeRef` guard (PORT-02) fails the port if any Claude-runtime reference
survives the transform [REF: scripts/adapt-gsd.ts:44-47]. So a ported persona never tells
an OpenClaw agent to read a Claude directory or run a CLI it does not have.

## The 33 subagents

Columns:

- **role** — one-line summary from the agent's `description` field
  [REF: src/agents/roster.generated.ts].
- **phase** — phase type the agent serves (planning / research / execution /
  verification / discuss), inferred from its role.
- **tier (balanced)** — model tier under the `balanced` profile, from `AGENT_CATALOG`
  [REF: src/engine/model.ts:31-66].
- **path verb** — the finite-path verb that dispatches this agent via `VERB_TO_SUBAGENT`,
  or `—` if the agent is not on the orchestrator's path map
  [REF: src/orchestrate/execute-path.ts:15-27].

| # | agent | role | phase | tier (balanced) | path verb |
|---|-------|------|-------|-----------------|-----------|
| 1 | `gsd-advisor-researcher` | Researches one gray-area decision, returns a comparison table + rationale | discuss | sonnet | — |
| 2 | `gsd-ai-researcher` | Researches a chosen AI framework's docs into implementation-ready guidance | research | sonnet | — |
| 3 | `gsd-assumptions-analyzer` | Analyzes codebase for a phase, returns structured assumptions with evidence | discuss | sonnet | — |
| 4 | `gsd-code-fixer` | Applies fixes from review findings, commits each atomically | execution | sonnet | — |
| 5 | `gsd-code-reviewer` | Reviews source for bugs/security/quality, writes severity-classified REVIEW.md | verification | sonnet | `code-review` |
| 6 | `gsd-codebase-mapper` | Explores codebase, writes structured analysis docs per focus area | research | haiku | `map-codebase` |
| 7 | `gsd-debug-session-manager` | Manages multi-cycle debug checkpoint/continuation loop in isolated context | execution | sonnet | — |
| 8 | `gsd-debugger` | Investigates bugs via scientific method, manages debug sessions | execution | sonnet | `debug` |
| 9 | `gsd-doc-classifier` | Classifies one planning doc as ADR/PRD/SPEC/DOC/UNKNOWN | planning | haiku | — |
| 10 | `gsd-doc-synthesizer` | Synthesizes classified docs into consolidated context, writes conflicts | planning | sonnet | — |
| 11 | `gsd-doc-verifier` | Verifies factual claims in generated docs against the live codebase | verification | sonnet | — |
| 12 | `gsd-doc-writer` | Writes/updates project documentation from a doc_assignment block | execution | sonnet | `docs` |
| 13 | `gsd-domain-researcher` | Researches business domain + expert eval criteria for an AI system | research | sonnet | — |
| 14 | `gsd-eval-auditor` | Retroactive audit of an AI phase's eval coverage, scores each dimension | verification | sonnet | — |
| 15 | `gsd-eval-planner` | Designs an AI phase's evaluation strategy, rubrics, dataset | planning | opus | `ai-integration` |
| 16 | `gsd-executor` | Executes GSD plans with atomic commits, deviation + checkpoint handling | execution | sonnet | `execute` |
| 17 | `gsd-framework-selector` | Interactive decision matrix to pick the right AI/LLM framework | discuss | sonnet | — |
| 18 | `gsd-integration-checker` | Verifies cross-phase integration and E2E flows connect | verification | sonnet | — |
| 19 | `gsd-intel-updater` | Analyzes codebase, writes structured intel files to `.planning/intel/` | research | sonnet | — |
| 20 | `gsd-nyquist-auditor` | Fills Nyquist validation gaps — generates tests, verifies coverage | verification | sonnet | — |
| 21 | `gsd-pattern-mapper` | Maps new files to closest existing-pattern analogs, writes PATTERNS.md | planning | sonnet | — |
| 22 | `gsd-phase-researcher` | Researches how to implement a phase before planning, writes RESEARCH.md | research | sonnet | `research` |
| 23 | `gsd-plan-checker` | Goal-backward check that a plan will achieve the phase goal | planning | sonnet | — |
| 24 | `gsd-planner` | Creates executable phase plans with task breakdown + dependency analysis | planning | opus | `plan` |
| 25 | `gsd-project-researcher` | Researches domain ecosystem before roadmap creation | research | sonnet | — |
| 26 | `gsd-research-synthesizer` | Synthesizes parallel researcher outputs into SUMMARY.md | research | sonnet | — |
| 27 | `gsd-roadmapper` | Creates project roadmaps with phase breakdown + requirement mapping | planning | sonnet | — |
| 28 | `gsd-security-auditor` | Verifies threat-model mitigations exist in code, writes SECURITY.md | verification | sonnet | `secure` |
| 29 | `gsd-ui-auditor` | Retroactive 6-pillar visual audit of implemented frontend, scored UI-REVIEW.md | verification | sonnet | — |
| 30 | `gsd-ui-checker` | Validates UI-SPEC.md design contracts against 6 quality dimensions | verification | sonnet | — |
| 31 | `gsd-ui-researcher` | Produces UI-SPEC.md design contract for frontend phases | research | sonnet | `ui` |
| 32 | `gsd-user-profiler` | Scores a developer profile across 8 behavioral dimensions | research | sonnet | — |
| 33 | `gsd-verifier` | Goal-backward verification that the codebase delivers the phase promise | verification | sonnet | `verify` |

All 33 agents have a `AGENT_CATALOG` entry, so every one resolves a tier under every
profile — there is no silent fallback to the parent model [REF: src/engine/model.ts:31-66].

## How they are dispatched

The orchestrator drives an ordered finite GSD path (from `selectPath`); each step is a
verb with a reason. `makeSubagentDispatcher` turns each step into either a subagent run,
a skill/gate no-op, or a hard failure [REF: src/orchestrate/execute-path.ts:43-58].

### Path verb → subagent

`VERB_TO_SUBAGENT` is the map from a path verb to the GSD subagent that executes it
[REF: src/orchestrate/execute-path.ts:15-27]:

```
map-codebase   → gsd-codebase-mapper
research       → gsd-phase-researcher
plan           → gsd-planner
execute        → gsd-executor
code-review    → gsd-code-reviewer
verify         → gsd-verifier
debug          → gsd-debugger
secure         → gsd-security-auditor
ui             → gsd-ui-researcher
ai-integration → gsd-eval-planner
docs           → gsd-doc-writer
```

For a mapped verb, the dispatcher builds a step message (`GSD <verb> step for intent: …`)
and calls `runSubagent`; the subagent's run status (`ok` / `error` / `timeout`) becomes
the step outcome [REF: src/orchestrate/execute-path.ts:52-56].

### Persona injection + model on a path dispatch

`runSubagent` is the code-driven dispatch of one subagent by `agentId`
[REF: src/dispatch/run-subagent.ts:113-154]:

1. **Sub-lane of an allowed base agent.** The `gsd-*` ids are personas, not allowlisted
   OpenClaw agents — spawning a session keyed directly on `gsd-*` fails the host's
   `subagents.allowAgents` check. When a `baseAgentId` is given, the persona runs as a
   sub-lane of it (`agent:<base>:<gsd-role>`) so the session is owned by an allowed agent
   [REF: src/dispatch/run-subagent.ts:119-125].
2. **Persona via `extraSystemPrompt`.** The resolved agent's `prompt` is injected per-call
   as `extraSystemPrompt`, and its `thinking` tier is carried as the run `lane`
   [REF: src/dispatch/run-subagent.ts:140-143]. (The `tools` allowlist is data-only and
   is **not** passed here — the run path has no tool argument; tool isolation is a
   separate `sessions_spawn` route [REF: src/dispatch/run-subagent.ts:11-17].)
3. **Model resolution.** The agent's tier is resolved from the project's GSD config and set
   on the run; `null` (unknown agent or `inherit` profile) leaves the parent model
   [REF: src/dispatch/run-subagent.ts:150-153].

### Skill/gate verbs and fail-closed

Some verbs intentionally have **no** subagent — they are interactive gates or skill-only
steps. These are the `SKILL_OR_GATE_VERBS`: `discuss`, `ship`, `spike`, `graphify`,
`complete-milestone` [REF: src/orchestrate/execute-path.ts:35]. For these the dispatcher
returns a no-op success so the path advances; whether the step halts is governed by the
step's static `gate` flag in `executePath` [REF: src/orchestrate/execute-path.ts:46-50,
99-103].

Any **other** unmapped verb is drift (a typo or a renamed verb in `selectPath`) and
**fails closed** — the dispatcher returns `ok: false` rather than silently passing, so a
mis-spelled enforcement verb (e.g. `code-review` → `review`) can never report success
while its step never ran [REF: src/orchestrate/execute-path.ts:46-49].

## Model routing

`resolveModel(agentId, config)` resolves each agent's model tier from the project's
`model_profile` [REF: src/engine/model.ts:88-107]. Precedence:

1. **Per-agent override** — `config.model_profile_overrides[agentId]`, honored only when
   it is a non-empty known tier (`opus` / `sonnet` / `haiku` / `inherit`); an empty or
   unrecognized override falls through rather than returning garbage
   [REF: src/engine/model.ts:86-92].
2. **Profile** — the requested `model_profile`, or `balanced` when the profile is unknown
   [REF: src/engine/model.ts:94-97]. `inherit` returns `inherit`
   [REF: src/engine/model.ts:99].
3. **Per-agent tier** — the agent's column in `AGENT_CATALOG` for the chosen profile
   (`quality` / `balanced` / `budget`), or `adaptive` derived from `routingTier` via
   `ADAPTIVE_TIER_MAP` [REF: src/engine/model.ts:101-106, 11-15].

Valid profiles: `quality`, `balanced`, `budget`, `adaptive`, `inherit`
[REF: src/engine/model.ts:17]. Because all 33 agents have a catalog entry, every dispatch
resolves a concrete tier — there is no silent parent-model inheritance for a known agent;
only an unknown id returns `null` [REF: src/engine/model.ts:101-102].

The three explicit-profile columns per agent [REF: src/engine/model.ts:24-29]:

| profile | meaning |
|---------|---------|
| `quality` | golden tier — highest model per agent |
| `balanced` | default working tier (the table above) |
| `budget` | cheapest acceptable tier per agent |

## Personas on agent-initiated spawns

The path dispatcher is the **code-driven** route. Subagents can also be spawned
**agent-initiated** (the host agent calls a spawn tool directly). `enforceSpawnPersona`
guarantees those ad-hoc spawns still carry the right GSD role
[REF: src/hooks/enforce-gate.ts:163-191]:

- It fires only on spawn tools, and only inside an actual GSD project (a `.planning`
  ancestor of cwd) — it never injects GSD personas into non-GSD agents' spawns
  [REF: src/hooks/enforce-gate.ts:168-173].
- It picks the matching `gsd-*` role for the spawn's task text via keyword rules,
  defaulting to `gsd-executor` so the spawn is never a bare instruction-less subagent
  [REF: src/hooks/enforce-gate.ts:138-156, 180].
- It rewrites the spawn's message param to prepend the role's persona prompt (writing back
  into the same `message` / `task` / `prompt` key the instruction came from), tagged
  `<!-- gsd-oc:persona -->` so a re-entrant spawn is not double-wrapped
  [REF: src/hooks/enforce-gate.ts:178, 183-190].

So whether a subagent is dispatched by the orchestrator's finite path or spawned
ad-hoc by an agent, it carries the correct GSD persona before it runs.
