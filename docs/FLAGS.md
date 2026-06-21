# Flags as a layer of intent

GSD commands take flags that change *what the same command does*. GSD-OC infers them from intent
(`src/orchestrate/flags.ts → suggestFlags(intent, command?)`), so intent drives both the command **and** its
arguments. `gsd_command` merges explicit flags with intent-inferred ones.

| Flag | Intent signal (examples) | Scope |
|---|---|---|
| `--all` | "review everything", "every phase", "comprehensive", "full sweep" | any |
| `--research` | "research it first", "investigate before" | any |
| `--forensic` | "deep/forensic/rigorous audit", "integrity check", "6-check" | any |
| `--auto` | "autonomously", "no gates", "don't stop/ask", "hands-off" | any |
| `--reviews` | "cross-AI", "peer review", "replanning", "another model review" | any |
| `--fix` | "apply the fixes", "auto-fix", "remediate" | code-review, audit-fix |
| `--tdd` | "TDD", "test-driven", "test first" | plan/execute |
| `--mvp` | "MVP", "minimum viable", "simplest thing" | plan/execute |
| `--power` | "power mode", "go hard", "deep plan" | discuss |
| `--batch` | "all at once", "in bulk" | discuss |
| `--analyze` | "analyze the codebase", "assess" | discuss |
| `--assumptions` | "surface the assumptions", "what are we assuming" | discuss |
| `--granularity` | "coarse/fine-grained", "small steps" | plan |
| `--bounce` | "bounce the plan", "iterate the plan" | plan |
| `--gaps` | "coverage gaps", "missing requirements", "uncovered" | plan/execute |
| `--prd` | "from the PRD/spec file" | plan |
| `--wave N` | "execute wave 2", "in parallel waves" | execute |
| `--interactive` | "step by step", "walk me through", "ask me" | execute/verify |
| `--draft` | "ship as a draft", "WIP", "not ready" | ship |
| `--repair` | "repair the state", "recover", "heal" | next/resume |
| `--backfill` | "backfill the missing", "retroactively" | any |
| `--context` | "gather more context", "with context" | discuss |
| `--from N` / `--to M` | "from phase 2 to 5", "phases 3-7" | any |

`--research` is on by default for substantial work (`workflow.research_before_questions: true`); `skip-research`
is rarely inferred. Phase ranges and `--wave N` carry their numbers extracted from the intent.

## Example
```
gsd_command { command: "code-review", intent: "review everything forensically and apply the fixes" }
→ subagent: gsd-code-reviewer, flags: ["--all", "--forensic", "--fix"]
```
