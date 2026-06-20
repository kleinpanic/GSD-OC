# PROMPT.md — GSD-OC `/goal` prompts + the complete ask record

This is the **authoritative, durable record** of every ask for this project and the paste-ready
`/goal` prompts that drive it. Nothing here may be silently dropped. When in doubt, this file +
`.planning/REQUIREMENTS.md` win. Keep this in sync with `.planning/` (PROJECT/REQUIREMENTS/ROADMAP).

## Sources of truth (always reference these — do not work from memory)
- **GSD methodology + proper usage:** https://github.com/open-gsd/gsd-core (and the local install
  `~/.claude/gsd-core/` + `~/.claude/agents/gsd-*.md` — the 33 subagents). All GSD work/implementation
  references this.
- **`/goal` mechanics:** https://code.claude.com/docs/en/goal — `/goal` sets a completion condition;
  after every turn a small fast model (Haiku) judges whether the condition holds **from what is
  surfaced in the conversation** (it does NOT run commands/read files), and Claude keeps working until
  it does. Condition ≤ 4000 chars. Bound runs with "…or stop after N turns". It is a session-scoped
  prompt-based Stop hook. **Implication:** every DONE condition must be demonstrable via transcript
  evidence (commands + outputs + a real-session transcript).
- **Claude Code best-practices:** https://code.claude.com/docs/en/best-practices — verify-with-evidence
  (tests/build/screenshot, show output not assertions), explore→plan→code, AskUserQuestion specs,
  adversarial subagent review in fresh context, manage context aggressively, fan-out for scale.
- **OpenClaw plugin SDK:** docs.openclaw.ai/plugins/* (see `.planning/research/DEEP-DOCS-RESEARCH.md`).

---

## Project in one line
A native OpenClaw plugin (`gsd-oc`, NO Claude Code runtime) that auto-engages the **full** GSD
methodology to structure the work of OpenClaw agents — so every coding project / OpenClaw improvement /
hard task is driven through research → codebase-map → plan → execute → verify → ship, retrieval-selecting
**all relevant** GSD skills + the 33 subagents, with documentation of actions and proof it works.

---

## The `/goal` prompts

### GOAL A — v1.0 (ACHIEVED, kept for the record)
v1.0 DoD was met and live-proven in-session: built plugin + own repo/package.json, GSD toolset +
auto-engage hook, NO Claude Code runtime / NO ACP-into-Claude target; CC-isms → OpenClaw primitives;
6 routers + toolSearch = 0 Discord slash slots; auto-engage live (agent:bootstrap) → first tool call
`gsd_workflow`, no `/command`; 160→169 tests green; GPG-signed commits. Tag `v1.0`.

### GOAL B — v1.1 (ACTIVE — paste this into `/goal`, ≤4000 chars)
```
/goal Build GSD-OC v1.1 to DoD, working the GSD way (open-gsd/gsd-core), research→plan→execute→verify per phase, NEVER stopping until done. DONE only when ALL hold, each demonstrated with evidence (commands+outputs+a real OpenClaw gateway transcript) in this conversation: (1) all 233 GSD docs (88 workflows+33 agents+67 refs+45 templates) indexed as a retrievable corpus bundled as plugin data, runtime never reads ~/.claude; (2) HYBRID retrieval — LanceDB embedded semantic + BM25 lexical + trigram, RRF-fused, no API key/secret; (3) incremental merkle/content-hash manifest; (4) gsd_retrieve tool, 0 Discord slash slots; (5) finite-path orchestrator that retrieval-selects ALL relevant GSD skills+subagents across the FULL lifecycle (not just plan/execute), enforced on autonomous ("go") + ~/codeWS work, explicit opt-out; (6) live proof all 33 subagents reachable+invoked in correct order, no /command, fanned out by Claude-as-orchestrator; (7) benchmark category that invokes the openclaw CLI with the minimax M3 agent actually USING the plugin, reviewing internal tool-usage, proving the agent is blocked/steered when acting wrongly so it (a) never deadlocks and (b) self-corrects, plus A/B (GSD-on vs GSD-off) + output/performance/behavior review with logged metrics; (8) v1.0 deferrals (Discord round-trip, ORCH-04, ENG-03b) closed. Enforce GSD usage: specs written, assumptions resolved + discussions held via AskUserQuestion, research ALWAYS during planning, cross-AI plan review + replanning, context7/web tools used, 33 subagents spawned at opus. Tests green + categorized + logged; GPG-signed, staged by name. No host config/secret mutation; never --no-verify/force-push. Stop+ask via AskUserQuestion at each GSD decision gate. Or stop after 60 turns and report status.
```

### GOAL C — the standing META-goal (HOW we work; applies to all GSD-OC work)
This is policy, enforced via `.planning/config.json` + CLAUDE.md, not a one-shot condition:
- **GSD always** for coding/big work: route through `/gsd-*`; no ad-hoc edits outside a GSD workflow.
- **Research ALWAYS during planning** (`workflow.research: true`, plan-phase `--research`); use context7 +
  web/firecrawl for any named library/API before coding (research-defaults).
- **Specs + assumptions + discussion** before building: `/gsd-spec-phase` → `/gsd-discuss-phase`,
  ambiguities resolved through **AskUserQuestion** decision gates (never guess load-bearing choices).
- **Claude as orchestrator, fan out the 33 subagents** in parallel where independent; **all 33 spawned
  at `opus`** (upgrade any sonnet→opus, any haiku→sonnet; default to opus).
- **Cross-AI plan review + replanning ALWAYS** (`/gsd-review` / plan-bounce) until no HIGH concerns.
- **All relevant GSD skills of the ~200 surface** are used along the finite path — not just plan/execute.
- **Everything tested, logged, reviewed** for correctness, performance, and the using-agent's
  tool-usage/thinking/behavior. Show evidence, never assert.

---

## Complete ask record (categorized — NOTHING dropped)

### A. Retrieval + full-surface coverage  → REQUIREMENTS RET-01..07
- Index all 233 GSD docs; reachable-by-intent to the OpenClaw agent.
- Hybrid retrieval: **semantic + lexical + trigram** (all three, fused) — LanceDB embedded (chosen over
  turbopuffer: no secret), chunking, embeddings, merkle/content-hash incremental manifest, vector +
  semantic + lexical index. `gsd_retrieve` tool, 0 Discord slots.

### B. Finite path + enforcement  → PATH-01..02, ENF-01..04
- Single finite path start→finish that invokes ALL relevant skills + subagents across the full lifecycle.
- Auto-enforced on autonomous ("go") + ~/codeWS work, explicit opt-out.
- Enforce proper GSD command usage: specs done, assumptions handled, AskUserQuestion discussions, all
  work via GSD frameworks, research-always, cross-AI review, context7/proper tools.
- Claude orchestrates; 33 subagents fanned out; all spawned at opus.

### C. Coverage proof  → COV-01
- Live proof all 33 subagents reachable + invoked in correct order, no `/command`.

### D. Benchmarks + testing categories  → BENCH-01..05
- **Distinct test categories** (unit / integration / live-gateway / **benchmark**).
- **Benchmark = invoke the openclaw CLI with the minimax M3 agent actually using the plugin.**
- Review **internal tool usage**: tools are actually called; the agent is **blocked or steered/corrected**
  when it tries to act in a manner it should not — proving (1) it **never deadlocks** and (2) it
  **self-corrects** properly.
- **A/B**: GSD-structured (on) vs unstructured (off), same tasks.
- **Output + performance + behavior review**: what the using-agent is thinking and how it behaves; logged.

### E. `/goal`-pipeline integration  → GOAL-01
- Intrinsically incorporate the plugin + its logic with the OpenClaw `/goal` command pipeline so the agent
  **does not stop working until the project is complete** AND works within GSD properly.

### F. v1.0 deferrals  → DEF-01..03
- Live Discord component round-trip; ORCH-04 live auto-advance; ENG-03(b) per-session toggle read-back.

### G. Configuration + process  → captured in `.planning/config.json` + GOAL C
- Proper GSD config: research-always, opus subagent profile, cross-AI review, verification gates,
  context7/firecrawl tools enabled.

---

## Definition of done
GOAL B holds (all 8, evidenced in a real OpenClaw gateway session), GOAL C policy is enforced via config +
CLAUDE.md, every category in the ask record maps to a tracked REQUIREMENT with a phase, and the work is
tested + logged + GPG-signed. Until then: keep working the GSD way; do not stop.

*Maintained alongside `.planning/REQUIREMENTS.md` (REQ-IDs) and `.planning/ROADMAP.md` (phases). Last updated 2026-06-19.*
