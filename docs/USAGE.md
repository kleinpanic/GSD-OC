<!-- generated-by: gsd-doc-writer -->
# GSD-OC Usage

GSD-OC is an OpenClaw internal plugin that brings the GSD methodology (research →
codebase-map → plan → execute → verify → ship) natively into OpenClaw for any agent. A
coding/big-work prompt auto-engages GSD and drives the full lifecycle — no Claude Code in the
loop, and no `/command` typed by the user.

This document covers how to **install**, **configure**, and **use** the plugin. Every command
and config key below is grounded in the repository source.

---

## Requirements

| Requirement | Value | Source |
|---|---|---|
| Node.js | `>= 22` | `package.json:6-8` (`engines.node`) |
| OpenClaw | `>= 2026.5.17` | `package.json:30-32` (`peerDependencies.openclaw`) |
| Module system | TypeScript ESM (`"type": "module"`) | `package.json:5` |
| Runtime dep | `typebox` (tool schemas), `@lancedb/lancedb` (vector store) | `package.json:26-29` |
| GSD corpus | A GSD install detected at **build time** | `scripts/build-corpus.ts:30-36` |

The corpus is **snapshotted at build time** from a local GSD install. `detectGsdInstall()` probes
the GSD homes of several agentic CLIs — claude / codex / opencode / gemini / pi / hermes / cursor /
copilot — for `gsd-core` / `workflows` content (`scripts/build-corpus.ts:33-35`). The runtime never
reads `~/.claude` or any external CLI dir; it reads the bundled snapshot shipped in `dist/`
(`scripts/copy-artifacts.mjs` header).

---

## Build

The plugin ships a compiled `dist/` plus a bundled retrieval corpus. Build steps, in order:

```bash
# 1. install dependencies
npm install

# 2. compile TS -> dist/ and copy retrieval artifacts into dist/retrieval/
npm run build
```

`npm run build` runs `tsc && node scripts/copy-artifacts.mjs` (`package.json:21`). `copy-artifacts`
copies the gitignored retrieval artifacts (`corpus.generated.json`, `vectors.generated.bin`,
`vectors.index.json`, `vectors.manifest.json`, `lancedb/`) from `src/retrieval/` into
`dist/retrieval/` so the shipped plugin is self-contained.

### Build the corpus and vectors

The retrieval artifacts are dev-time build products, not committed. Regenerate them when the
source GSD install changes:

```bash
# snapshot the GSD surface into src/retrieval/corpus.generated.json
npm run build:corpus

# embed the corpus into vectors + a LanceDB table (semantic retrieval)
#   needs a reachable spark NIM: SPARK_HOST (or SPARK_EMBEDDINGS_BASE_URL) + a bearer token
SPARK_EMBEDDINGS_BASE_URL=http://YOUR_SPARK_HOST:18091/v1 \
SPARK_BEARER_TOKEN=… \
  npm run build:vectors
```

- `build:corpus` runs `node --experimental-strip-types scripts/build-corpus.ts`
  (`package.json:22`). It throws if no GSD install is detected (`scripts/build-corpus.ts:32-36`).
- `build:vectors` runs `node --experimental-strip-types scripts/build-vectors.ts`
  (`package.json:23`). It imports the **compiled** `dist/` modules, so run `npm run build` first
  (`scripts/build-vectors.ts:10-17`).
- Vectors are incremental — unchanged chunks are reused from the prior build via a merkle manifest
  (`scripts/build-vectors.ts:29-36`).

Without vectors (or without spark configured), retrieval still works: it degrades to lexical
(BM25) + trigram search, just without the semantic modality (`src/index.ts:269,280`).

### Validate the plugin package

```bash
npx openclaw plugins build      # produces the build artifacts openclaw expects
npx openclaw plugins validate   # diffs api.registerTool names against the metadata contract
```

`validate` reads the tool-plugin metadata symbol attached to the entry and checks each
`tools[].name` matches a registered tool (`src/index.ts:377-420`).

---

## Install into OpenClaw

The plugin **never mutates the host config** — it only reads it (`src/index.ts:108-112`,
`src/engage/opt-out.ts:8-10`). All host-config writes below are operator actions you approve via
`openclaw config patch --dry-run`. Full step-by-step with array-replace caveats is in
`.planning/INSTALL.md`.

1. **Install / link the repo** (does not write host config):

   ```bash
   openclaw plugins install --link ~/codeWS/JavaScript/GSD-OC
   ```

2. **Register + enable** the plugin in the host config (`plugins.allow`,
   `plugins.load.paths`, `plugins.entries.gsd-oc`). <!-- VERIFY: host openclaw.json path and existing allowlist contents are operator-specific -->

3. **Enable the hooks** under `plugins.entries.gsd-oc.hooks`:
   - `allowPromptInjection: true` — gates the `before_prompt_build` auto-engage meta-prompt; the
     hook is inert without it (`src/index.ts:138-147`).
   - `allowConversationAccess: true` — gates the `before_agent_finalize` auto-advance loop
     (`src/index.ts:152-154`).

4. **Bind the tools to each agent's `tools.allow`.** Each agent's allow list is exclusive —
   `profile: "full"` alone does not expose plugin tools (`.planning/INSTALL.md:13-37`). Add the
   tool names (or the `gsd-oc` plugin-id token) to every agent that should run GSD.

5. **Reload the gateway** (operator-run, outside the wrapped agent shell).

All GSD-OC tools are `registerTool` tools, so they consume **zero** of Discord's 100 global
slash-command slots — they surface via toolSearch (`.planning/INSTALL.md:277-279`).

---

## The tools an agent sees

The plugin registers **10 tools** — four named tools plus six namespace routers
(`src/index.ts:196-355`). Every one is a `registerTool` tool → **0 Discord slash slots**.

| Tool | Fires when | Source |
|---|---|---|
| `gsd_orchestrate` | Route an intent through the lifecycle. Returns the ordered GSD path; pass `drive:true` to dispatch each step as a subagent (halts at gates), `autoGates:true` for an autonomous run. | `src/index.ts:196-265` |
| `gsd_retrieve` | Hybrid skill/subagent retrieval for a free-text intent (semantic + BM25 + trigram, RRF-fused). Surfaces long-tail skills the routers miss, e.g. "the build is flaky" → `gsd-debug`. | `src/index.ts:270-294` |
| `gsd_settings` | Inspect the project's GSD config (model profile, workflow toggles, git) from `.planning/config.json` with defaults applied. `{bootstrap:true}` writes a default config if none exists (never overwrites). | `src/index.ts:299-311` |
| `gsd_state` | Advance `.planning/STATE.md` atomically (`op`: `set-status` \| `record-progress` \| `add-decision` \| `add-blocker`). Call as GSD work completes so route() sees live state. | `src/index.ts:316-348` |
| `gsd_workflow` | Router: phase-pipeline intent (discuss/plan/execute/verify/phase/progress). | `src/routers/routers.ts:20-27` |
| `gsd_project` | Router: project-lifecycle intent (milestones/audits/summary/stats). | `src/routers/routers.ts:28-33` |
| `gsd_quality` | Router: quality-gate intent (code-review/debug/audit/secure/eval/ui). | `src/routers/routers.ts:34-39` |
| `gsd_context` | Router: codebase-intelligence intent (map/graphify/docs/learnings). | `src/routers/routers.ts:40-45` |
| `gsd_manage` | Router: management intent (config/workspace/workstreams/thread/update/ship/inbox). | `src/routers/routers.ts:46-51` |
| `gsd_ideate` | Router: exploration/capture intent (explore/sketch/spike/spec/capture). | `src/routers/routers.ts:52-57` |

The six routers front ~200 concrete GSD verbs so the long tail is reachable via toolSearch without
spending slash slots (`src/routers/routers.ts:4-11`). Each router returns the state-aware
authoritative next verb via the wired route engine (`src/routers/route-wire.ts`,
`src/index.ts:353-355`).

### `gsd_orchestrate` modes

- **Plan only** (default): returns `path` (ordered lifecycle steps with `verb`/`skill`/`gate`/`reason`),
  `relevant_skills`, and `how_to_execute` instructions for the agent to dispatch each step
  (`src/index.ts:222-234`).
- **Drive** (`drive:true`): if the in-plugin subagent runtime is reachable, dispatches each
  non-gate step as a subagent and **halts at each `gate:true` step** for approval
  (`src/index.ts:244-257`). If the runtime is not reachable it returns the plan with
  `drive_available:false` and the agent dispatches steps via its own spawn tool
  (`src/index.ts:241-243`).
- **Autonomous** (`drive:true, autoGates:true`): auto-proceeds through decision gates instead of
  halting (`src/index.ts:53-55, 249`).

---

## Configuration

### `.planning/config.json`

`gsd_settings` reads this file and deep-merges it over the canonical defaults from
`defaultGsdConfig()` (`src/engine/config.ts:33-64`). When the file is absent or unparseable, the
defaults are used and `source` is reported as `"default"` (`src/engine/config.ts:95-108`).

Top-level keys and their defaults (`src/engine/config.ts:33-64`):

| Key | Default | Meaning |
|---|---|---|
| `model_profile` | `"balanced"` | Subagent model tier. |
| `commit_docs` | `true` | Commit planning docs. |
| `parallelization` | `true` | Allow parallel subagent fan-out. |
| `git.branching_strategy` | `"none"` | Branch policy for phases/milestones. |
| `git.create_tag` | `true` | Tag on ship. |

Workflow toggles (`config.workflow.*`, `src/engine/config.ts:44-62`):

| Toggle | Default | Effect |
|---|---|---|
| `research` | `true` | Research-first planning stage. |
| `plan_check` | `true` | Plan-quality gate. |
| `verifier` | `true` | Goal-backward verification stage. |
| `code_review` | `true` | Code-review stage. |
| `security_enforcement` | `true` | Security threat-model stage on security-sensitive work. |
| `plan_bounce` | `false` | Plan revision loop. |
| `auto_advance` | `false` | Cross-turn auto-advance loop. |
| `tdd_mode` | `false` | Test-first execution. |
| `discuss_mode` | `"discuss"` | Discussion gate behavior. |
| `human_verify_mode` | `"end-of-phase"` | When human verification is required. |

#### Enforcement gate toggle

`workflow.enforce_tool_gate` controls the keystone enforcement hook. It is **opt-out**: the gate
is active by default (the key is absent from `defaultGsdConfig()`), and only an explicit
`enforce_tool_gate: false` disables it (`src/hooks/enforce-gate.ts:106`). With the gate on,
file-mutation tools (`edit`, `write`, `file_write`, `apply_patch`, `multiedit`, `str_replace`,
`create_file`) are **blocked** when the project is under GSD but the current phase has not been
planned yet (route() returns `discuss-phase` / `plan-phase`) (`src/hooks/enforce-gate.ts:27-30,
123-131`). A failed, unresolved verification is a hard halt that also blocks edits
(`src/hooks/enforce-gate.ts:112-117`). The gate fails **open** on any internal error — a buggy
gate never bricks tool calls (`src/index.ts:177-180`).

### Environment — semantic retrieval (spark)

Semantic retrieval embeds via a "spark" NIM (OpenAI-compatible `POST {base}/embeddings`,
2048-dim, asymmetric `input_type`). The bearer token is read from the environment and never inlined
or logged (`src/retrieval/embed.ts:1-6`).

| Variable | Purpose |
|---|---|
| `SPARK_EMBEDDINGS_BASE_URL` | Explicit base URL (e.g. `http://YOUR_SPARK_HOST:18091/v1`). Takes precedence. |
| `SPARK_HOST` | Host only — base URL is derived as `http://{host}:{SPARK_PORT or 18091}/v1`. |
| `SPARK_PORT` | Override the default port `18091`. |
| `SPARK_BEARER_TOKEN` / `SPARK_API_KEY` / `SPARK_BEARER_AUTH` | Bearer token (any one). |
| `SPARK_EMBEDDINGS_MODEL` | Override the default `nvidia/llama-nemotron-embed-vl-1b-v2`. |

`embedAvailable()` returns true only when both a base URL and a token resolve
(`src/retrieval/embed.ts:49-51`). When false, retrieval degrades to lexical + trigram and
`gsd_retrieve`/`gsd_orchestrate` report `degraded`/`retrieval_degraded`
(`src/index.ts:228,286`). Use a generic host placeholder — never commit a real endpoint.
<!-- VERIFY: the actual spark host/IP and bearer token are environment-specific and must not be documented here -->

### Opt-out

GSD auto-engage and the enforcement gate are suppressed by any of (`src/engage/opt-out.ts:64-75`):

- **`.gsd-off` marker** — a file named `.gsd-off` (or `.planning/.gsd-off`) in the project root or
  any ancestor up to `$HOME` (`src/engage/opt-out.ts:19-34`). A root-level `/.gsd-off` is
  ignored (box-wide, out of scope).
- **Host plugin config** — `pluginConfig.disabled === true` or `pluginConfig.autoEngage === false`
  (`src/engage/opt-out.ts:41-44`).
- **Per-project gate disable** — `workflow.enforce_tool_gate: false` disables only the enforcement
  hook, not engage (`src/hooks/enforce-gate.ts:106`).

Auto-engage's prompt injection additionally only fires when cwd is under `~/codeWS`
(`.planning/INSTALL.md:214-216`); the 10 tools themselves are callable from any cwd once granted.

---

## Worked example: "add OAuth login"

An agent in a `~/codeWS` project receives the prompt **"add OAuth login"**.

1. **Auto-engage.** The `agent:bootstrap` / `before_prompt_build` hooks inject the GSD meta-prompt
   (gated to `~/codeWS`, not opted out), nudging the agent to route the intent through GSD before
   editing code (`src/index.ts:138-147, 190-193`).

2. **Orchestrate.** The agent calls `gsd_orchestrate` with `intent: "add OAuth login"`. The tool
   retrieves the relevant GSD skills, then builds the ordered path with `selectPath`
   (`src/index.ts:221-222`). Because the intent matches the security vocabulary
   (`oauth`/`login` are in the secure conditional regex, `src/orchestrate/select-path.ts:81`), the
   path includes the **secure** stage. The emitted path (backbone + secure):

   ```
   discuss        gsd-discuss-phase        gate     core: gather context + decisions
   map-codebase   gsd-map-codebase                  core: map existing code before planning
   research       gsd-plan-phase --research         core: research-first
   plan           gsd-plan-phase           gate     core: plan from research + context
   secure         gsd-secure-phase                  security-sensitive — threat model
   execute        gsd-execute-phase                 core: implement the plan
   code-review    gsd-code-review                   core: review changed code
   verify         gsd-verify-work          gate     core: goal-backward verification
   ship           gsd-ship                          core: PR + ship
   ```

   (Backbone: `src/orchestrate/select-path.ts:32-41`; secure stage at `pos:65`, inserted after
   `plan` / before `execute`: `src/orchestrate/select-path.ts:81`.)

3. **Drive (optional).** With `drive:true`, the orchestrator dispatches each non-gate step as a
   subagent under the `dev` worker agent (overridable via `pluginConfig.workerAgent`) and halts at
   the `discuss`, `plan`, and `verify` gates for approval (`src/index.ts:244-257`).

4. **Enforcement gates the edits.** If the agent tries to `edit`/`write` an OAuth source file
   before the phase is planned, the `before_tool_call` hook blocks it with a corrective message:
   "phase N is not planned yet (next GSD step: plan-phase). Plan before editing — call
   gsd_orchestrate with your intent first" (`src/hooks/enforce-gate.ts:123-131`). Once route()
   reports `execute`/`verify`/`ship`, edits are allowed (`src/hooks/enforce-gate.ts:132`).

5. **Spawned subagents carry a GSD persona.** Any subagent the agent spawns inside the GSD project
   is rewritten to carry the matching `gsd-*` persona — a security/auth task maps to
   `gsd-security-auditor` (`src/hooks/enforce-gate.ts:144, 163-191`).

6. **State advances.** As each stage completes, the agent calls `gsd_state` (e.g.
   `op: "set-status", status: "executing"`) so route() runs on live `.planning/STATE.md` state, not
   a stale snapshot (`src/index.ts:316-348`).

The result: the OAuth work is researched, threat-modeled, planned, implemented, reviewed, and
verified through the full GSD lifecycle — with edits gated until the phase is planned — without the
user typing a single `/command`.
