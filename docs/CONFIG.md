# Configuration

GSD-OC has **two config layers** (deliberately separate — a project file must never grant host privileges):

| Layer | Where | Governs | Written by |
|---|---|---|---|
| **Operator** | host `openclaw.json → plugins.entries.gsd-oc.config` (the declared `configSchema`) | *activation + host-permission* | the operator, by hand |
| **Project** | `<project>/.planning/config.json` | *how the lifecycle runs* | the plugin (`gsd_init`/`gsd_settings`) |

Precedence (only at init): `project value > operator default > built-in default`.

## Operator layer (`configSchema`)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `engageMode` | `workspace`\|`intent`\|`off` | `workspace` | engage on a coding cwd+intent / on coding intent anywhere / never |
| `codingRoots` | `string[]` | `[]` | extra coding-workspace dirs (`~`/`$VAR` expand); markers detect projects anyway |
| `includeDefaultRoot` | `boolean` | `true` | include the built-in `$HOME/codeWS` root |
| `workerAgent` | `string` | `dev` | allowlisted base agent hosting GSD personas |
| `autoEngage` / `disabled` | `boolean` | `true`/`false` | master engagement switches |

## Project layer (`.planning/config.json`) — full GSD parity

The native `defaultGsdConfig()` ships the complete upstream key set (read with `readGsdConfig`, deep-merged,
prototype-pollution-hardened). Groups:

**Core:** `mode` (interactive\|auto), `model_profile` (quality\|balanced\|budget\|adaptive\|inherit),
`model_profile_overrides` (per-agent), `effort.default`, `granularity`, `phase_naming`, `project_code`,
`commit_docs`, `parallelization`, `search_gitignored`, `agent_skills`, `sub_repos`, `context`, and the inert
Claude-compat keys (`resolve_model_ids`, `context_window`, `response_language`, `text_mode`).

**`workflow.*`** (the lifecycle gates/levers — managed by intent or the agent):
`research`, `research_before_questions` (**default true**), `plan_check`/`plan_checker`, `verifier`,
`nyquist_validation`, `code_review`, `code_review_depth`, `security_enforcement`, `security_asvs_level`,
`security_block_on`, `plan_bounce`/`plan_bounce_passes`, `auto_advance`, `auto_prune_state`,
`node_repair`/`node_repair_budget`, `pattern_mapper`, `skip_discuss`, `max_discuss_passes`, `subagent_timeout`,
`use_worktrees`, `enforce_tool_gate`, `inline_plan_threshold`, `post_planning_gaps`, `ui_phase`,
`ui_safety_gate`, `ui_review`, `ai_integration_phase`, `tdd_mode`, `discuss_mode`, `human_verify_mode`.

**`git.*`:** `branching_strategy` (none\|phase\|milestone\|quick), `base_branch`, `create_tag`,
`phase_branch_template`, `milestone_branch_template`, `quick_branch_template`, `auto_repo`
(**private**\|public\|off — default-on private GitHub repo at init), `auto_repo_owner`.

**`ship.pr_body_sections`**, **`profiles`** (reference + surface), **`manager.flags`** (`execute`/`discuss`/`plan`).

**External research providers** (encouraged when available, detected at runtime): `brave_search`, `firecrawl`, `exa_search`.

**Cross-AI review:** `review.external` (`[]` or any of `coderabbit`\|`codex`\|`gemini`\|`claude`\|`opencode`),
`review.cross_ai_plan_review`, `review.models` (per-cli model ref, e.g. `{ "glm": "glm/glm-4.6" }`). Cross-AI
review delegates to a different model via the OpenClaw ACP seam (`subagent.run({ model })`) — see
[ARCHITECTURE.md](ARCHITECTURE.md).

**Features / hooks / learning / intel:** `features.global_learning`, `features.thinking_partner`,
`hooks.context_warnings` (**default false**), `learning.max_inject`, `intel.enabled`.

## Tools that read/write config
- `gsd_settings` — inspect the project config (defaults applied); `{bootstrap:true}` writes a default if absent.
- `gsd_state {op:"init"}` — scaffold a full `.planning/` (config + STATE/ROADMAP/REQUIREMENTS/PROJECT), validated.
- Engagement (`engageMode`/`codingRoots`) is the operator layer; see [USAGE.md](USAGE.md).

## Advisory vs engine-enforced keys

Most `workflow.*` keys are **engine-enforced** (read by route/enforce-gate/orchestrate and change behavior):
`enforce_tool_gate`, `use_worktrees`, `auto_advance`, `auto_verify`, `skip_discuss`, `ui_safety_gate`,
`ai_integration_phase`, `pattern_mapper`, `nyquist_validation`, `security_enforcement`, plus `mode`, `git.*`,
`review.*`, `manager.flags`, the research-provider toggles, and the profile layer.

A few are **advisory** — surfaced to the agent via `gsd_settings` and honored in the subagent prompts rather than
enforced by an engine branch: `research_before_questions`, `node_repair`/`node_repair_budget`, `auto_prune_state`,
`inline_plan_threshold`, `security_block_on`, `code_review_depth`, `learning.max_inject`, `granularity`. These are
intentional knobs the planner/executor/reviewer subagents read; they are not dead — they shape agent behavior, not
control flow.
