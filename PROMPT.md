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

### Decision: per-milestone `/goal` prompts (NOT one mega-goal)

Grounded in the three researched sources:
- `/goal` allows **one active condition per session, ≤4000 chars**, judged each turn by a *fast model that
  reads only the transcript* (it runs no commands). A whole-project condition is too large and
  multi-faceted for that evaluator to judge faithfully.
- Claude best-practices **and** gsd-core both insist on **fresh context per unit** (context rot degrades
  quality); a single goal forces one ever-growing session.
- gsd-core's lifecycle is **milestone-based** (discuss→plan→execute→verify→ship per milestone).

So the v1.1 work is sectioned into **four goal-bounded milestones M1–M4** (over roadmap phases 8–15). Set
one `/goal` per milestone, drive it to its DoD in a focused session, `/clear`, then set the next. **In
every milestone the top-level Claude is the GSD orchestrator/delegator** — it fans out the 33 subagents
(all at opus), never hand-codes what a subagent should own.

| Milestone | Phases | Requirements | One-line DoD |
|---|---|---|---|
| **M1 — Retrieval Core** | 8–10 | RET-01..07 | `gsd_retrieve` fuses semantic+lexical+trigram over 233 docs, 0 slots |
| **M2 — Finite-Path + Enforcement** | 11–12 | PATH, ENF, COV | live no-`/command` finite path; all 33 subagents invoked in order |
| **M3 — Benchmark & Behavior** | 13 | BENCH-01..05 | openclaw-CLI/minimax-M3 run + A/B + block-and-steer, logged |
| **M4 — Goal Integration + Deferrals** | 14–15 | GOAL-01, DEF | `/goal` don't-stop loop within GSD; v1.0 deferrals closed |

Each milestone is a **proper GSD version**: **M1 = v1.1 (ACTIVE), M2 = v1.2, M3 = v1.3, M4 = v1.4** —
each promoted to its own GSD milestone via `/gsd-new-milestone` when reached. Today only **v1.1 / M1** is
active in GSD state, so **start with M1** (paste the M1 `/goal` below; Phase 8 is already done → next Phase 9).

### GOAL B — milestone `/goal` prompts (paste ONE per session, each ≤4000 chars)

**M1 — Retrieval Core**
```
/goal As the GSD orchestrator/delegator (delegate to gsd-subagents at opus; research-always; cross-AI plan review), build GSD-OC milestone M1 "Retrieval Core" to DoD per open-gsd/gsd-core. DONE only when, shown with commands+outputs in-conversation: (1) all ~233 GSD docs snapshotted at build from the detected GSD install + chunked, and at runtime the plugin is self-contained — reads only its own bundled data, not any external agentic-CLI config/state dir (claude/codex/opencode/gemini/pi/openclaw-host-config); ephemeral caches/tmp/DGX are out of scope; (2) a hybrid gsd_retrieve fuses LanceDB embedded semantic + BM25 lexical + trigram via RRF, no API key/secret; (3) an incremental merkle manifest re-indexes only changed docs; (4) gsd_retrieve is registered as an OpenClaw tool consuming 0 Discord slash slots (registerCommand==0; plugins validate green); (5) a free-text intent returns relevant long-tail skills the 6 routers alone miss (e.g. "the build is flaky"→gsd-debug). Tests categorized + green (show command+output), GPG-signed, staged by name; no host/secret mutation; never --no-verify/force-push. Stop+ask via AskUserQuestion at each GSD decision gate. Or stop after 50 turns and report.
```

**M2 — Finite-Path + Enforcement**
```
/goal As the GSD orchestrator/delegator (fan out the 33 subagents at opus; research-always; cross-AI review), build GSD-OC milestone M2 "Finite-Path + Enforcement" to DoD per open-gsd/gsd-core. DONE only when, evidenced in a REAL OpenClaw gateway transcript: (1) a finite-path orchestrator retrieval-selects (via gsd_retrieve) the relevant GSD skills+subagents across the FULL lifecycle per project intent, not a static table; (2) it is enforced on autonomous + ~/codeWS work with an explicit opt-out; chat/quick one-offs stay off-path; (3) GSD-usage enforcement holds: no phase proceeds without a written spec + resolved assumptions + an AskUserQuestion discussion; research always runs in planning; plans pass cross-AI review/replanning until no HIGH concerns; (4) all 33 subagents are reachable + invoked in the correct lifecycle order with NO /command, fanned out at opus by Claude-as-orchestrator. Tests categorized + green, GPG-signed, staged by name; no host/secret mutation; never --no-verify/force-push. AskUserQuestion at each gate. Or stop after 50 turns and report.
```

**M3 — Benchmark & Behavior**
```
/goal As the GSD orchestrator/delegator, build GSD-OC milestone M3 "Benchmark & Behavior" to DoD per open-gsd/gsd-core. DONE only when, with logged evidence in-conversation: (1) distinct test categories exist (unit / integration / live-gateway / benchmark); (2) a benchmark invokes the OpenClaw CLI driving the minimax M3 agent ACTUALLY using the plugin on real tasks; (3) internal tool usage is reviewed (which tools fired, in what order); (4) the run proves the agent is blocked or steered/corrected on disallowed actions so it NEVER deadlocks and self-corrects; (5) an A/B compares GSD-on vs GSD-off over the same tasks; (6) an output/performance/behavior report with logged metrics (recall, coverage, tool-usage, outcome) is written under .planning/. Tests green (show command+output), GPG-signed, staged by name; no host/secret mutation; never --no-verify/force-push. AskUserQuestion at each gate. Or stop after 50 turns and report.
```

**M4 — Goal Integration + Deferral Closure**
```
/goal As the GSD orchestrator/delegator, build GSD-OC milestone M4 "Goal Integration + Deferrals" to DoD per open-gsd/gsd-core. DONE only when, evidenced in a real session: (1) the plugin lifecycle integrates with the OpenClaw /goal (don't-stop-until-done) pipeline, exposing an evaluator-readable completion signal so an agent keeps working within GSD until the project DoD holds; (2) the no-deadlock + opt-out guarantees hold under the don't-stop loop; (3) the v1.0 deferrals are closed or documented as platform-blocked with a fallback proven: live Discord component round-trip (buttons/select/poll), ORCH-04 cross-turn auto-advance, ENG-03(b) per-session toggle read-back. Tests green, GPG-signed, staged by name; no host/secret mutation; never --no-verify/force-push. AskUserQuestion at each gate. Or stop after 50 turns and report.
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
