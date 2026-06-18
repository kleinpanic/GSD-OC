# GSD-OC Repository Structure

**Purpose:** Port the GSD (Get Shit Done) framework to OpenClaw as a native plugin.
**Source:** `~/.claude/get-shit-done/` v1.39.0
**Workspace:** `~/codeWS/JavaScript/GSD-OC/`
**Language:** TypeScript (ESM), Node >= 22

---

## Directory Map

```
GSD-OC/
├── GSD-SOURCE/                          # Local clone of GSD source (read-only)
│   └── .planning/research/gsd-source/  # Full v1.39.0 source tree
│
├── unsorted/                            # PHASE 1: All copied GSD markdown files (as-is)
│   ├── commands/       (65 files)      # commands/gsd/ — thin wrapper entry points
│   ├── workflows/      (99 files)      # get-shit-done/workflows/ — actual workflow logic
│   │   ├── discuss-phase/
│   │   │   ├── modes/  (9 files)       # discuss mode variants (auto, batch, chain, etc.)
│   │   │   └── templates/  (3 files)   # discussion-log.md, checkpoint.json, context.md
│   │   └── execute-phase/
│   │       └── steps/  (3 files)       # gate checks before plan execution
│   ├── agents/         (33 files)      # Subagent prompt definitions
│   ├── references/     (53 files)       # Reference docs for workflows
│   ├── templates/      (46 files)       # .planning/ file blueprints + research-project/
│   │   ├── research-project/ (5 files) # Architecture, Features, Pitfalls, Stack, Summary
│   │   └── *.md (templates for state, project, roadmap, requirements, etc.)
│   ├── contexts/       (3 files)        # dev.md, research.md, review.md
│   └── docs/           (23 files)       # Top-level docs, non-i18n
│       └── adr/                       # Architecture decision records (NOT COPIED - check)
│
├── sorted/                              # PHASE 1: Fixed markdown files (OpenClaw-compatible)
│   ├── commands/
│   ├── workflows/
│   ├── agents/
│   ├── references/
│   ├── templates/
│   ├── contexts/
│   └── docs/
│
├── src/                                 # PHASE 2: TypeScript plugin source
│   ├── index.ts                         # Plugin entry point
│   ├── commands/                        # /gsd-* command implementations
│   ├── lib/                             # Core utilities (router, planner, state adapter)
│   └── types/                           # TypeScript type definitions
│
├── tests/                               # PHASE 3: Test suite
│
├── openclaw.plugin.json                 # Plugin manifest
├── package.json                         # npm package config
├── tsconfig.json                        # TypeScript configuration
└── README.md                            # Project overview
```

---

## GSD Source File Breakdown

### unsorted/commands/ — 65 files
**Source:** `commands/gsd/` (metadata files, YAML frontmatter)
**Purpose:** Slash command entry points. Each file has YAML frontmatter with:
- `name` — command name (e.g., `do`, `autonomous`, `execute-phase`)
- `description` — one-line description
- `allowed-tools` — list of permitted tools
- `execution_context` — references to actual workflow files

**Key files (most referenced):**
| File | Purpose |
|------|---------|
| `do.md` | Main dispatcher/router — routes input to 30+ subcommands |
| `autonomous.md` | Full-phase orchestration loop |
| `execute-phase.md` | Plan execution workflow |
| `plan-phase.md` | Planning workflow |
| `discuss-phase.md` | Discussion workflow |
| `verify-phase.md` | Verification workflow |
| `new-project.md` | Project bootstrapping |
| `help.md` | Help system |
| `plan-review-convergence.md` | Plan review |
| `add-phase.md` | Add new phase to roadmap |
| `code-review.md` | Code review workflow |
| `cleanup.md` | Session/project cleanup |
| `add-tests.md` | Test generation |
| `spike.md` | Exploratory investigation |
| `sketch.md` | Quick prototype |
| `fast.md` | Fast execution mode |
| `capture.md` | Learning capture |
| `forensics.md` | Debug/investigation |
| `progress.md` | Progress reporting |
| `settings.md` | Settings management |
| `validate-phase.md` | Phase validation |
| `secure-phase.md` | Security analysis |
| `sync-skills.md` | Skills sync |
| `health.md` | Health check |
| `review.md` | Review workflow |
| `complete-milestone.md` | Milestone completion |
| `new-milestone.md` | New milestone |
| `insert-phase.md` | Insert phase |
| `remove-phase.md` | Remove phase |
| `list-workspaces.md` | Workspace listing |
| `remove-workspace.md` | Remove workspace |
| `new-workspace.md` | Create workspace |
| `map-codebase.md` | Codebase mapping |
| `scan.md` | Scan/diagnostic |
| `update.md` | Update workflow |
| `undo.md` | Undo last action |
| `next.md` | Next action |
| `quick.md` | Quick mode |
| `pause-work.md` | Pause workflow |
| `resume-project.md` | Resume project |
| `transition.md` | Transition workflow |
| `ship.md` | Ship/release |
| `node-repair.md` | Node repair |
| `spec-phase.md` | Spec generation |
| `edit-phase.md` | Edit phase |
| `docs-update.md` | Docs update |
| `diagnose-issues.md` | Issue diagnosis |
| `eval-review.md` | Eval review |
| `extract-learnings.md` | Extract learnings |
| `import.md` | Import workflow |
| `ingest-docs.md` | Document ingestion |
| `inbox.md` | Inbox management |
| `list-phase-assumptions.md` | List assumptions |
| `manager.md` | Manager workflow |
| `milestone-summary.md` | Milestone summary |
| `note.md` | Note taking |
| `plan-milestone-gaps.md` | Gap planning |
| `plant-seed.md` | Seed project |
| `pr-branch.md` | PR branch |
| `profile-user.md` | User profiling |
| `reapply-patches.md` | Patch reapplication |
| `session-report.md` | Session report |
| `stats.md` | Statistics |
| `analyze-dependencies.md` | Dependency analysis |

**Files to PORT FIRST (critical path):**
1. `do.md` — dispatcher, needed by all others
2. `new-project.md` — bootstrapping, needed to start new projects
3. `help.md` — help system

---

### unsorted/workflows/ — 99 files (including subdirectories)
**Source:** `get-shit-done/workflows/`
**Purpose:** The actual workflow logic. Thin vs. fat: most files are fat (contain full prompts/logic).

**Subdirectories:**
- `discuss-phase/modes/` (9 files): `advisor.md`, `all.md`, `analyze.md`, `auto.md`, `batch.md`, `chain.md`, `default.md`, `power.md`, `text.md`
- `discuss-phase/templates/` (3 files): `context.md`, `discussion-log.md`, `checkpoint.json`
- `execute-phase/steps/` (3 files): `codebase-drift-gate.md`, `per-plan-worktree-gate.md`, `post-merge-gate.md`

**Top-level workflow files:**
| File | Purpose |
|------|---------|
| `do.md` | Routing logic (same as commands/gsd/do.md) |
| `autonomous.md` | Master orchestration — discuss→plan→execute per phase |
| `execute-phase.md` | Execute all plans in a phase |
| `execute-plan.md` | Execute a single plan |
| `discuss-phase.md` | Discussion workflow |
| `plan-phase.md` | Planning workflow |
| `verify-phase.md` | Verification |
| `validate-phase.md` | Phase validation |
| `new-project.md` | Project creation |
| `code-review.md` | Code review |
| `add-phase.md` | Add phase to roadmap |
| `add-tests.md` | Test generation |
| `cleanup.md` | Cleanup |
| `complete-milestone.md` | Milestone completion |
| `ai-integration-phase.md` | AI integration |
| `audit-fix.md` | Audit fix |
| `audit-milestone.md` | Milestone audit |
| `audit-uat.md` | UAT audit |
| `check-todos.md` | Check todos |
| `code-review-fix.md` | Code review fix |
| `diagnose-issues.md` | Diagnosis |
| `discovery-phase.md` | Discovery |
| `discuss-phase-assumptions.md` | Discuss assumptions |
| `docs-update.md` | Docs update |
| `edit-phase.md` | Edit phase |
| `eval-review.md` | Eval review |
| `explore.md` | Exploration |
| `extract_learnings.md` | Learnings extraction |
| `fast.md` | Fast mode |
| `forensics.md` | Forensics |
| `graduation.md` | Graduation |
| `health.md` | Health |
| `help.md` | Help |
| `import.md` | Import |
| `ingest-docs.md` | Doc ingestion |
| `insert-phase.md` | Insert phase |
| `list-phase-assumptions.md` | List assumptions |
| `list-workspaces.md` | List workspaces |
| `manager.md` | Manager |
| `map-codebase.md` | Codebase map |
| `milestone-summary.md` | Milestone summary |
| `new-milestone.md` | New milestone |
| `new-workspace.md` | New workspace |
| `next.md` | Next action |
| `node-repair.md` | Node repair |
| `note.md` | Note |
| `pause-work.md` | Pause |
| `plan-milestone-gaps.md` | Gap planning |
| `plan-review-convergence.md` | Plan review |
| `plant-seed.md` | Seed |
| `pr-branch.md` | PR branch |
| `profile-user.md` | Profile user |
| `progress.md` | Progress |
| `quick.md` | Quick |
| `reapply-patches.md` | Reapply |
| `remove-phase.md` | Remove phase |
| `remove-workspace.md` | Remove workspace |
| `resume-project.md` | Resume |
| `review.md` | Review |
| `scan.md` | Scan |
| `secure-phase.md` | Secure phase |
| `ship.md` | Ship |
| `sketch.md` | Sketch |
| `sketch-wrap-up.md` | Sketch wrap-up |
| `spike.md` | Spike |
| `spike-wrap-up.md` | Spike wrap-up |
| `stats.md` | Stats |
| `sync-skills.md` | Sync skills |
| `transition.md` | Transition |
| `ui-phase.md` | UI phase |
| `ui-review.md` | UI review |
| `ultraplan-phase.md` | Ultra planning |
| `undo.md` | Undo |
| `update.md` | Update |
| `verify-work.md` | Verify work |

---

### unsorted/agents/ — 33 files
**Source:** `agents/`
**Purpose:** Subagent prompt templates for specialized roles.

| Agent | Purpose |
|-------|---------|
| `gsd-codebase-mapper.md` | Maps codebase structure |
| `gsd-debugger.md` | Debug/investigate |
| `gsd-executor.md` | Execute plans |
| `gsd-planner.md` | Create plans |
| `gsd-advisor-researcher.md` | Research advisor |
| `gsd-project-researcher.md` | Project research |
| `gsd-research-synthesizer.md` | Synthesize research |
| `gsd-roadmapper.md` | Create roadmaps |
| `gsd-security-researcher.md` | Security research |
| `gsd-security-researcher-v2.md` | Security research v2 |
| `gsd-requirement-analyst.md` | Requirements analysis |
| `gsd-requirement-writer.md` | Write requirements |
| `gsd-spec-writer.md` | Write specs |
| `gsd-architecture-planner.md` | Architecture planning |
| `gsd-frontend-planner.md` | Frontend planning |
| `gsd-frontend-developer.md` | Frontend development |
| `gsd-backend-developer.md` | Backend development |
| `gsd-fullstack-developer.md` | Fullstack development |
| `gsd-devops-engineer.md` | DevOps |
| `gsd-qa-tester.md` | QA testing |
| `gsd-ux-researcher.md` | UX research |
| `gsd-product-manager.md` | Product management |
| `gsd-tech-lead.md` | Technical lead |
| `gsd-security-engineer.md` | Security engineering |
| `gsd-database-specialist.md` | Database |
| `gsd-api-designer.md` | API design |
| `gsd-performance-engineer.md` | Performance |
| `gsd-docs-writer.md` | Documentation |
| `gsd-reviewer.md` | Code review |
| `gsd-test-writer.md` | Test writing |
| `gsd-devoops-automation.md` | DevOps automation |
| `gsd-architect.md` | Architecture |
| `gsd-sre.md` | Site reliability |

---

### unsorted/references/ — 53 files
**Source:** `get-shit-done/references/`
**Purpose:** Reference documentation for workflows and agents.

| File | Purpose |
|------|---------|
| `agent-contracts.md` | Subagent contract definitions |
| `ai-evals.md` | AI evaluation methods |
| `ai-frameworks.md` | AI framework comparison |
| `artifact-types.md` | Artifact type definitions |
| `autonomous-smart-discuss.md` | Smart discuss mode |
| `checkpoints.md` | Checkpoint system |
| `common-bug-patterns.md` | Bug patterns |
| `context-budget.md` | Context budget management |
| `continuation-format.md` | Continuation format |
| `debugger-philosophy.md` | Debug philosophy |
| `decimal-phase-calculation.md` | Phase numbering |
| `doc-conflict-engine.md` | Doc conflict resolution |
| `domain-probes.md` | Domain probing |
| `executor-examples.md` | Executor examples |
| `few-shot-examples/plan-checker.md` | Few-shot plan checker |
| `few-shot-examples/verifier.md` | Few-shot verifier |
| `gate-prompts.md` | Gate prompt definitions |
| `gates.md` | Gate system |
| `git-integration.md` | Git integration |
| `git-planning-commit.md` | Planning commits |
| `ios-scaffold.md` | iOS scaffolding |
| `mandatory-initial-read.md` | Required reads |
| `model-profile-resolution.md` | Model profiles |
| `model-profiles.md` | Model configuration |
| `phase-argument-parsing.md` | Phase args |
| `planner-antipatterns.md` | Planner anti-patterns |
| `planner-chunked.md` | Chunked planning |
| `planner-gap-closure.md` | Gap closure |
| `planner-reviews.md` | Plan reviews |
| `planner-revision.md` | Plan revision |
| `planner-source-audit.md` | Source audit |
| `planning-config.md` | Planning config |
| `project-skills-discovery.md` | Skills discovery |
| `questioning.md` | Questioning strategy |
| `revision-loop.md` | Revision loop |
| `scout-codebase.md` | Codebase scouting |
| `sketch-interactivity.md` | Sketch interactivity |
| `sketch-theme-system.md` | Theme system |
| `sketch-tooling.md` | Sketch tooling |
| `sketch-variant-patterns.md` | Variant patterns |
| `tdd.md` | Test-driven development |
| `thinking-models-debug.md` | Thinking models for debug |
| `thinking-models-execution.md` | Thinking models for exec |
| `thinking-models-planning.md` | Thinking models for planning |
| `thinking-models-research.md` | Thinking models for research |
| `thinking-models-verification.md` | Thinking models for verify |
| `thinking-partner.md` | Thinking partner |
| `ui-brand.md` | UI branding |
| `universal-anti-patterns.md` | Anti-patterns |
| `user-profiling.md` | User profiling |
| `verification-overrides.md` | Verification overrides |
| `verification-patterns.md` | Verification patterns |
| `workstream-flag.md` | Workstream flags |

---

### unsorted/templates/ — 46 files
**Source:** `get-shit-done/templates/`
**Purpose:** Blueprints for `.planning/` files.

**Core templates:**
| File | Purpose |
|------|---------|
| `state.md` | `.planning/STATE.md` — living project memory |
| `project.md` | `.planning/PROJECT.md` — project context |
| `roadmap.md` | `.planning/ROADMAP.md` — phase/plan roadmap |
| `requirements.md` | `.planning/REQUIREMENTS.md` — checkable requirements |
| `spec.md` | `.planning/SPEC.md` — feature specification |
| `config.json` | `.planning/config.json` — project configuration |
| `milestone.md` | `.planning/milestone-NAME.md` — milestone doc |
| `milestone-archive.md` | Milestone archive |
| `phase-prompt.md` | Phase prompt template |
| `discussion-log.md` | Discussion log |
| `continue-here.md` | Session continuation |
| `context.md` | Planning context |
| `retrospective.md` | Retrospective |
| `validation.md` | Validation template |
| `verification-report.md` | Verification report |
| `AI-SPEC.md` | AI specification |
| `UAT.md` | User acceptance testing |
| `SECURITY.md` | Security specification |
| `discovery.md` | Discovery doc |
| `debug-subagent-prompt.md` | Debug agent prompt |
| `planner-subagent-prompt.md` | Planner agent prompt |
| `summary-minimal.md` | Minimal summary |
| `summary-standard.md` | Standard summary |
| `summary-complex.md` | Complex summary |
| `summary.md` | General summary |
| `user-profile.md` | User profile |
| `user-setup.md` | User setup |
| `dev-preferences.md` | Dev preferences |
| `copilot-instructions.md` | Copilot instructions |
| `claude-md.md` | CLAUDE.md template |
| `DEBUG.md` | Debug template |

**Subdirectory:**
- `research-project/` (5 files): `ARCHITECTURE.md`, `FEATURES.md`, `PITFALLS.md`, `STACK.md`, `SUMMARY.md`
  - Used by `new-project.md` research phase to generate project research docs

---

### unsorted/contexts/ — 3 files
**Source:** `get-shit-done/contexts/`
**Purpose:** Pre-built context files for different session modes.

| File | Purpose |
|------|---------|
| `dev.md` | Development context |
| `research.md` | Research context |
| `review.md` | Review context |

---

### unsorted/docs/ — 23 files
**Source:** `docs/` (top-level, non-i18n)
**Purpose:** Documentation files.

| File | Purpose |
|------|---------|
| `README.md` | GSD README |
| `AGENTS.md` | Agent system docs |
| `ARCHITECTURE.md` | Architecture overview |
| `BETA.md` | Beta features |
| `CLI-TOOLS.md` | CLI tools reference |
| `COMMANDS.md` | Command reference |
| `CONFIGURATION.md` | Configuration guide |
| `FEATURES.md` | Features overview |
| `context-monitor.md` | Context monitoring |
| `discovery-contract.md` | Skills discovery contract |
| `INVENTORY.md` | Asset inventory |
| `issue-driven-orchestration.md` | Orchestration design |
| `manual-update.md` | Manual update guide |
| `STATE-MD-LIFECYCLE.md` | STATE.md lifecycle |
| `workflow-discuss-mode.md` | Discuss mode docs |
| `RELEASE-v1.39.0-rc.4.md` | Release notes |
| `RELEASE-v1.39.0-rc.5.md` | Release notes |
| `RELEASE-v1.39.0-rc.6.md` | Release notes |
| `RELEASE-v1.39.0-rc.7.md` | Release notes |
| `RELEASE-v1.40.0-rc.1.md` | Release notes |
| `gsd-sdk-query-migration-blurb.md` | SDK migration guide |

---

## Non-Markdown Files to Port (Phase 2)

These are NOT in `unsorted/` — they require separate handling:

### JavaScript/TypeScript Files

**SDK (TypeScript, `sdk/src/`):**
- Full TypeScript SDK for programmatic GSD plan execution
- `index.ts` — main GSD class
- `cli.ts`, `cli-transport.ts` — CLI interface
- `config.ts` — config loading
- `plan-parser.ts` — plan file parsing
- `prompt-builder.ts` — prompt construction
- `phase-runner.ts`, `milestone-runner.ts` — execution runners
- `context-engine.ts` — context management
- `event-stream.ts` — event streaming
- `query/` — query layer (50+ query handlers)
- `golden/` — golden tests
- Tests: `*.test.ts` files throughout

**SDK package.json:** `@gsd-build/sdk` npm package, TypeScript, ESM

**bin/lib/ (CommonJS, `get-shit-done/bin/lib/`):**
- `state.cjs` — STATE.md read/write/patch
- `config.cjs` — config.json operations
- `roadmap.cjs` — ROADMAP.md operations
- `milestone.cjs` — milestone operations
- `phase.cjs` — phase operations
- `frontmatter.cjs` — frontmatter parsing
- `core.cjs` — core utilities
- `intel.cjs` — intelligence/analysis
- `learnings.cjs` — learnings capture
- `audit.cjs` — audit system
- `verify.cjs` — verification
- `docs.cjs` — docs operations
- `template.cjs` — template rendering
- `decisions.cjs` — decision tracking
- `init.cjs` — initialization
- `secrets.cjs` — secrets management
- `security.cjs` — security checks
- `graphify.cjs` — graph utilities
- `validate-command-router.cjs` — validation routing
- `command-aliases.generated.cjs` — command aliases
- Plus 20+ more lib files

**gsd-sdk.js (bin/):**
- CLI entry point for `gsd-sdk` command
- Delegates to `bin/lib/` functions

**hooks/ (JavaScript):**
- `gsd-context-monitor.js`
- `gsd-statusline.js`
- `gsd-update-banner.js`
- `gsd-workflow-guard.js`
- `gsd-prompt-guard.js`
- `gsd-read-guard.js`
- `gsd-check-update.js`
- `gsd-check-update-worker.js`
- `gsd-session-state.sh` (shell)
- `gsd-phase-boundary.sh` (shell)
- `gsd-validate-commit.sh` (shell)

### Configuration Files

**config.json template:**
```json
{
  "mode": "interactive",
  "granularity": "standard",
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "auto_advance": false,
    "nyquist_validation": true,
    "security_enforcement": true,
    "security_asvs_level": 1,
    "security_block_on": "high",
    "discuss_mode": "discuss",
    "research_before_questions": false,
    "code_review_command": null,
    "plan_bounce": false,
    "plan_bounce_script": null,
    "plan_bounce_passes": 2,
    "cross_ai_execution": false,
    "cross_ai_command": "",
    "cross_ai_timeout": 300
  },
  "planning": {
    "commit_docs": true,
    "search_gitignored": false,
    "sub_repos": []
  },
  "parallelization": {
    "enabled": true,
    "plan_level": true,
    "task_level": false,
    "skip_checkpoints": true,
    "max_concurrent_agents": 3,
    "min_plans_for_parallel": 2
  },
  "gates": {
    "confirm_project": true,
    "confirm_phases": true,
    "confirm_roadmap": true,
    "confirm_breakdown": true,
    "confirm_plan": true,
    "execute_next_plan": true,
    "issues_review": true,
    "confirm_transition": true
  },
  "safety": {
    "always_confirm_destructive": true,
    "always_confirm_external_services": true
  },
  "hooks": {
    "context_warnings": true
  },
  "project_code": null,
  "agent_skills": {},
  "claude_md_path": "./CLAUDE.md"
}
```

### Package Files

**Root package.json:** `get-shit-done-cc` v1.39.0, Node >= 22, CLI tool
**SDK package.json:** `@gsd-build/sdk` v1.39.0, TypeScript, ESM

---

## Porting Task: Tool Reference Mapping

When moving files from `unsorted/` → `sorted/`, the tool references must be mapped:

| GSD Tool | OpenClaw Equivalent |
|----------|-------------------|
| `Read` | `read` tool |
| `Write` | `write` tool |
| `Edit` | `edit` tool |
| `Bash` | `exec` tool |
| `Glob` | `exec` with `find` |
| `Grep` | `exec` with `rg` |
| `WebFetch` | `web_fetch` |
| `NotebookRead` | N/A (Jupyter-specific) |
| `NotebookEdit` | N/A (Jupyter-specific) |
| `TodoWrite` | `oc-tasks` CLI |
| `Agent` (subagent spawn) | `sessions_spawn` |
| `AskUserQuestion` | Direct message to Klein |
| `Read(CLAUDE_MD_PATH)` | `read` SOUL.md, AGENTS.md |
| `TodoList` | `oc-tasks list` |
| `Search` | `web_search` |
| `Batch` | `exec` with multiple commands |

**Runtimes to handle:**
- `claude` → OpenClaw (school agent)
- `codex` → `codex` model
- `gemini` → `gemini` model
- `opencode` → various open models

**Key patterns to replace:**
- `CLAUDE.md` → OpenClaw agent files (SOUL.md, AGENTS.md, etc.)
- `gsd-sdk query <cmd>` → Direct file read + parsing
- `gsd-tools` CLI → Native OpenClaw tools

---

## Phase 2: JS/JSON Porting Details

### Option A: Full TypeScript SDK Port
Port `sdk/src/` (TypeScript) directly. OpenClaw is TypeScript-native. This gives us:
- `GSD` class for programmatic plan execution
- Query layer for state/config/roadmap operations
- Phase/milestone runners
- Event streaming

### Option B: Thin Adapter Layer
Keep the markdown workflows as the source of truth. Parse `.planning/` files directly with native OpenClaw tools. Replace `gsd-sdk query` calls with `read` + `exec` tool calls.

**Recommendation:** Option B for Phase 1. Option A for Phase 2 if needed.

### bin/lib/ Functions to Port (CJS → TypeScript)
Priority order:
1. `state.cjs` — most used, critical path
2. `config.cjs` — config loading
3. `roadmap.cjs` — roadmap operations
4. `milestone.cjs` — milestone operations
5. `phase.cjs` — phase operations
6. `frontmatter.cjs` — frontmatter parsing
7. `core.cjs` — utility functions

---

## Phase 3: Testing

**GSD Tests to Port:**
- `sdk/src/gsd-tools.test.ts` — core tools tests
- `sdk/src/cli.test.ts` — CLI tests
- `sdk/src/config.test.ts` — config tests
- `sdk/src/plan-parser.test.ts` — plan parsing tests
- `sdk/src/phase-runner.test.ts` — phase runner tests
- `sdk/src/golden/` — golden integration tests
- `sdk/src/e2e.integration.test.ts` — end-to-end tests
- `sdk/src/phase-runner.integration.test.ts` — integration tests

**Test infrastructure:**
- GSD uses `vitest` (TypeScript)
- Coverage requirement: 70% lines
- `sdk/scripts/run-tests.cjs` — test runner
- GSD SDK build required before tests (`npm run build:sdk`)

**OpenClaw test approach:**
- Plugin tests using OpenClaw plugin SDK test utilities
- Integration tests with actual `.planning/` file operations
- CLI tests using `exec` tool

---

## Quick Start

To begin Phase 1 porting work:

```bash
# View a file needing porting
cat unsorted/commands/do.md

# Compare with source
cat ~/.claude/get-shit-done/commands/gsd/do.md

# Move fixed file to sorted/
cp unsorted/commands/do.md sorted/commands/do.md
# ... edit sorted/commands/do.md to fix tool references ...

# Check current porting progress
find sorted/ -type f | wc -l
```
