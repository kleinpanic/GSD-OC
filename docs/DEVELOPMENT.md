<!-- generated-by: gsd-doc-writer -->
# Development

Internals reference for working on GSD-OC: project layout, the build pipeline, the
generated artifacts, how to run and write tests, and the recursive-review methodology that
drove the codebase to convergence. For setup and contribution norms, see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Project layout

```
src/                  TypeScript source (ESM, NodeNext)
  engine/             native GSD state engine — state machine, commit, phase, model routing
  retrieval/          hybrid retrieval — corpus, chunk, bm25, embed, vectors, RRF fuse, manifest
    lancedb/          generated LanceDB table (gitignored, shipped in dist)
  hooks/             OpenClaw lifecycle hooks (before_prompt_build, agent lifecycle)
  engage/            auto-engage — intent classification, coding-marker detection, opt-out
  orchestrate/       finite-path selector + execute engine (gsd_orchestrate)
  dispatch/          subagent dispatch (run-subagent) — injects ported personas
  agents/            ported GSD subagent roster (roster.generated.ts + types)
  routers/           tool routers (toolSearch surface under the 0-slot rule)
  routing/           slot-audit (0-Discord-slot invariant)
  gates/             Discord-native decision gates (buttons, modal, poll, select, resume)
  loop/              autonomous loop ordering/decision
  state/             STATE.md read/write with O_EXCL locking
  index.ts           plugin entry — registerTool wiring, hook + service registration

test/                 node:test suites (52 files), compiled to dist-test/
scripts/              dev-time build tooling (NOT runtime dependencies)
  build-corpus.ts     snapshot + chunk + adapt the detected GSD install -> corpus.generated.json
  build-vectors.ts    embed corpus via spark NIM -> vectors.* + lancedb/
  adapt-gsd.ts        PORT-01 text adaptation (Claude-runtime refs -> bundled/native form)
  port-agents.ts      parse ~/.claude/agents/gsd-*.md -> roster.generated.ts
  copy-artifacts.mjs  post-build: bundle corpus + vectors into dist/ for self-containment
  benchmark.ts        retrieval/orchestration benchmark
  score.ts            scoring harness
.planning/            GSD lifecycle artifacts (requirements, roadmap, phases, reviews, scoring)
```

The runtime ships from `dist/` only. `package.json` `files` publishes `dist`,
`openclaw.plugin.json`, and `README.md`; `.npmignore` excludes `src/`, `test/`, `.planning/`,
`research/`, and the tsconfig files.

## Build pipeline

```bash
npm run build
```

runs two steps:

1. **`tsc`** — compiles `src/` to `dist/` (ESM, `target: ES2022`, `module: NodeNext`,
   `strict`). `tsconfig.json` includes only `src` and excludes `dist`, `dist-test`,
   `.planning`, `research`, and `test`.
2. **`node scripts/copy-artifacts.mjs`** — copies the gitignored retrieval artifacts from
   `src/retrieval/` into `dist/retrieval/` so the shipped plugin is self-contained. At
   runtime the loaders read these bundled copies next to the compiled module — never the dev
   source tree and never an external CLI directory. The copy is tolerant: it bundles whatever
   of `corpus.generated.json`, `vectors.generated.bin`, `vectors.index.json`,
   `vectors.manifest.json`, and `lancedb/` is present.

### Corpus build

```bash
npm run build:corpus    # node --experimental-strip-types scripts/build-corpus.ts
```

Detects a GSD install (probes the claude/codex/opencode/gemini/pi/hermes/cursor/copilot
homes for `gsd-core`/`workflows`), snapshots the full GSD doc surface, runs the PORT-01
`adaptGsdText` transform on every doc (rewrites `~/.claude` path references and the
`gsd-tools` CLI into bundled/native language so a ported persona never tells an OpenClaw
agent to read a Claude dir or shell a CLI it lacks), chunks every doc, and stamps a merkle
manifest (RET-06). Emits `src/retrieval/corpus.generated.json`. If no install is detected,
it fails loudly rather than producing an empty corpus.

### Vector build

```bash
# Point the base URL at a reachable spark embeddings endpoint; token comes from env, never inlined.
SPARK_EMBEDDINGS_BASE_URL=http://<spark-host>:<port>/v1 npm run build:vectors
```

Embeds the bundled corpus through the spark NIM (asymmetric `input_type` — `passage` for
the corpus side) and writes two gitignored artifacts that ship in `dist`: a Float32 vector
matrix (`vectors.generated.bin` + `vectors.index.json`) and a LanceDB table (`lancedb/`),
plus `vectors.manifest.json`. The build is **incremental** — it reloads the prior vector
cache and the prior manifest, so `diffManifest` re-embeds only changed chunks and reuses
the rest (RET-06).

`build:vectors` imports from the **compiled `dist/` modules**, not `src/` — run
`npm run build` first. (See the strip-types `.js`-import constraint in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md).) It calls `sparkConfig()` up front to fail fast
with a clear message if the spark environment is missing. Host values shown here are
generic examples — supply your own reachable endpoint.

## Generated files

Three artifact sets are produced at build time from the detected GSD install. Two are
gitignored; one (the roster) is committed.

| Artifact | Produced by | Tracked? | Regenerate |
|---|---|---|---|
| `src/agents/roster.generated.ts` | `scripts/port-agents.ts` | yes (committed) | `node --experimental-strip-types scripts/port-agents.ts` |
| `src/retrieval/corpus.generated.json` | `scripts/build-corpus.ts` | no (gitignored, shipped in dist) | `npm run build:corpus` |
| `src/retrieval/vectors.generated.bin`, `vectors.index.json`, `vectors.manifest.json`, `lancedb/` | `scripts/build-vectors.ts` | no (gitignored, shipped in dist) | `npm run build:vectors` |

- **`roster.generated.ts`** — the ported GSD subagent roster. `port-agents.ts` parses the
  `gsd-*.md` source agents (it asserts exactly 33 sources), maps each agent's Claude-Code
  tool tokens to OpenClaw tool ids, drops `mcp__*` and `AskUserQuestion`, throws on any
  unknown token (fail-loud), runs the same `adaptGsdText` transform on each persona, and
  inlines the result so the roster ships in `dist` with no runtime filesystem read. The file
  is committed but is **generated — do not edit by hand**; re-run the script to update it.
- **`corpus.generated.json` / `vectors.*`** — the retrieval substrate. Gitignored because
  they are large, regenerable build outputs; `copy-artifacts.mjs` bundles them into
  `dist/retrieval/` so the published plugin is self-contained.

All three are derived from the GSD install detected at build time — they are not authored by
hand and should never be edited directly.

## Testing

The suite uses Node's built-in `node:test` runner — no third-party framework.

```bash
npm test
```

runs `tsc -p tsconfig.test.json` (compiles `src` + `test` into `dist-test/`) then
`node --test "dist-test/test/*.test.js"`. The full suite is **342 tests across 52 files**.

### Test categories

| Area | Example suites |
|---|---|
| engine / route | `engine-route`, `engine-state`, `engine-phase`, `engine-commit`, `engine-model`, `route-hardening` |
| retrieval | `bm25`, `chunk`, `tokenize`, `trigram`, `semantic`, `embed`, `fuse`, `retrieve`, `vectors`, `vectors-hardening`, `index-build`, `manifest` |
| enforcement / gates | `enforce-gate`, `gate-buttons`, `gate-modal`, `gate-poll`, `gate-select`, `gate-resume` |
| state / mutation | `read-state`, `mutate`, `config-merge` |
| engage / orchestrate | `auto-engage`, `engage-classify`, `engage-opt-out`, `select-path`, `execute-path`, `drive-path` |
| dispatch / agents | `run-subagent`, `dispatch.roster`, `agents.roster`, `agents-md` |
| invariants | `slot-audit`, `no-forbidden-deps`, `manifest`, `route-hardening` |

### Run a single test

Build the test tree once, then point `node --test` at one compiled file:

```bash
tsc -p tsconfig.test.json
node --test dist-test/test/mutate.test.js
```

Or filter to a single named test within a file:

```bash
node --test --test-name-pattern="0-slot" dist-test/test/slot-audit.test.js
```

### The slot-audit triple-consistency check

`test/slot-audit.test.ts` proves the 0-Discord-slot invariant deterministically and
offline (no gateway). It cross-checks three counts that must stay consistent:

1. **`registerCommand` call count** — must be `0` (a spy API records every registration
   kind; `registerCommandCalls` must be `0`).
2. **manifest `commands[]` count** — `openclaw.plugin.json` must declare no commands
   (`manifestCommandCount === 0`).
3. **registered-tool count** — both the runtime `registerTool` calls and the manifest
   `contracts.tools[]` must be `>= 7` and `<= 100` (the entire surface goes through tools,
   within the Discord cap).

The combined verdict asserts `globalSlashCommands = registerCommandCalls +
manifestCommandCount === 0`. `assertZeroSlots` throws `0-slot invariant violated` if either
command source is non-zero, so a stray `registerCommand` call or a `commands[]` entry fails
the build. This keeps the manifest, the runtime registration, and the roster wiring mutually
consistent.

## Recursive-review methodology

GSD-OC was hardened through **nine adversarial review rounds** (opus reviewers vs. the
codebase), each round fixing findings then re-reviewing — see
[`.planning/REVIEW-LOG.md`](../.planning/REVIEW-LOG.md) for the full trajectory. The
convergence criterion was **no CRITICAL/HIGH finding for a full round**, treating "perfect"
as asymptotic (adversarial review can always surface lower-severity items).

The rounds drove the codebase from ~297 to **342 tests**:

- Rounds 1–5 audited every module at least once, fixing concrete bugs including a CRITICAL
  spawn-contamination defect, a HIGH prototype-pollution defect, and a CRITICAL gate-skip
  defect; confirmed `commit.ts` shell-injection-free, the `state.ts` lock core TOCTOU-safe,
  and the retrieval RRF math correct.
- Round 6 confirmed the cross-cutting integration flows (state write→read, model routing,
  project detection, manifest triple) and fixed a BLOCKER in security-gate auth coverage.
- Rounds 7–8 fixed asymmetric bold-verdict (`**Status:**`) handling on the PASS and FAIL
  route readers.
- **Round 9 confirmed convergence**: the three verdict readers are mutually symmetric, the
  broad sweep found no CRITICAL/HIGH, and the single remaining WARNING was closed.

Accepted-risk items that were tracked rather than fixed (low value vs. risk, or needing a
larger change) are documented at the bottom of `REVIEW-LOG.md`. When changing audited code,
read that log first — it records which invariants were verified and why certain low-severity
items were deliberately left.
