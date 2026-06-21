<!-- generated-by: gsd-doc-writer -->
# Hybrid Retrieval Engine

GSD-OC turns a free-text coding intent into a ranked list of the GSD skills and
subagents that fit it — including the long-tail cases a static keyword router
misses. A prompt like *"the build is flaky"* contains none of the words in any
debug document, yet the engine still surfaces `gsd-debugger`. It does this by
fusing four search modalities (BM25 lexical, character-trigram, dense semantic,
and their reciprocal-rank fusion) over a corpus snapshotted at build time from
the detected GSD install. The runtime is self-contained: it reads only the
plugin's own bundled artifacts, never `~/.claude` or any host file.

This document describes the corpus, the four modalities, fusion, incremental
re-indexing, the public `gsd_retrieve` tool, and configuration.

---

## Goal

The six Discord-native routers in GSD-OC cover the common, well-named GSD
commands. They cannot cover the long tail of free-text intent — a user
describing a *symptom* ("tests pass locally but fail in CI", "the build is
flaky") rather than naming a command. The retrieval engine is the long-tail
bridge: arbitrary coding/big-work prose in, ranked GSD docs out.

The acceptance bar (DoD item 5) is the *flaky build* case. The literal token
"flaky" appears in **zero** debug-doc chunks, so the lexical and trigram
modalities alone cannot reach `gsd-debugger` from that query — proven during
development (phase 09-01). Only the semantic modality bridges the vocabulary
gap, which is why semantic is weighted above the lexical modalities in fusion
(see [Fusion](#fusion-reciprocal-rank-fusion) below).
[REF: src/retrieval/retrieve.ts:6-8]

---

## The Corpus

The corpus is a single bundled JSON artifact (`corpus.generated.json`,
gitignored, ~6 MB) generated at **build time** — never at runtime. It snapshots
the full GSD documentation surface from whichever GSD install the build host
has, chunks every document, adapts each to be runtime-agnostic, and stamps a
merkle manifest.

### Composition

The current snapshot contains **251 documents → 3712 chunks**, broken down by
kind: [REF: src/retrieval/vectors.manifest.json:1]

| Kind       | Docs | Source root                          |
|------------|------|--------------------------------------|
| workflow   | 106  | `gsd-core/workflows` (recursive — includes top-level + nested sub-workflows) |
| agent      | 33   | `agents` (filtered to `gsd-*.md`)    |
| reference  | 67   | `gsd-core/references`                |
| template   | 45   | `gsd-core/templates` (recursive)     |

The `workflow` kind is walked recursively, so it captures both the top-level
workflows and the nested sub-workflow files. The `agent` kind is filtered to
files matching `gsd-*.md`, so only GSD subagents enter the corpus.
[REF: src/retrieval/build-corpus.ts:41] [REF: src/retrieval/detect.ts:89-94]

A document is one source markdown file; its stable id is
`${kind}:${relpath-without-ext}` (e.g. `workflow:plan-phase`,
`agent:gsd-debugger`). A chunk is a heading-bounded, size-bounded slice of a
doc, with id `${docId}#${ordinal}`. [REF: src/retrieval/types.ts:10-32]

### Multi-CLI detection + deny-list

The build does not hard-code `~/.claude`. `detect.ts` probes the config homes
of every supported agentic CLI — claude, codex, opencode, gemini, pi, hermes,
cursor, copilot — and selects the first that has a `gsd-core/workflows`
directory. [REF: src/retrieval/detect.ts:62-107]

Snapshotting reads files under allow-listed doc roots only, and on top of that
enforces a **deny-list** as defense-in-depth. The walker
(`safeList`) skips any entry matching the deny dirs/globs (`.ssh`, `.gnupg`,
`.aws`, `.env`, `id_rsa`, `*.pem`, `*.key`, `*_history`, etc.) and **never
follows symlinks** — so a `workflows/x.md` symlink pointing at `~/.ssh/id_rsa`
cannot bake a secret into the committed corpus.
[REF: src/retrieval/detect.ts:19-47] [REF: src/retrieval/detect.ts:118-122]

### Runtime-agnostic adaptation

The snapshotted docs were authored for Claude Code — they instruct the agent to
read `$HOME/.claude/gsd-core/...` files and shell a `gsd-tools` CLI, neither of
which exists in an OpenClaw runtime. `adapt-gsd.ts` rewrites those
Claude-runtime assumptions into runtime-agnostic language at snapshot time:
bundled file references become `reference:foo` / `template:foo` retrievable via
`gsd_retrieve`, CLI invocations become the native `gsd-oc-engine`, and
"Claude Code" becomes "the OpenClaw agent". Every corpus doc passes through this
transform. [REF: scripts/adapt-gsd.ts:12-42] [REF: scripts/build-corpus.ts:60-62]

### Chunking

`chunk.ts` splits each doc at markdown headings (`#`–`###`), then packs each
section's paragraphs into chunks of at most 1200 chars without ever splitting a
paragraph. Fenced code blocks are skipped when detecting headings. Chunking is
**deterministic** by design: the same input yields byte-identical chunks, so the
merkle manifest is stable and embeddings are recomputed only on real change.
[REF: src/retrieval/chunk.ts:1-7] [REF: src/retrieval/chunk.ts:82]

### Self-contained runtime

Build writes `corpus.generated.json` into `src/retrieval/`; the build step then
copies it (and the vector artifacts) into `dist/retrieval/`. At runtime the
loader prefers the copy bundled next to the compiled module, so it reads
**only** the plugin's own data. [REF: src/retrieval/corpus.ts:21-38]

---

## The Four Modalities

Two modalities are pure-TypeScript and always run; one is dense-vector semantic
(requires the spark embeddings endpoint + the build's vector artifact); the
fourth is the fusion that combines them.

### 1. BM25 — lexical

Standard Okapi BM25 over chunk text with Lucene defaults `k1 = 1.2`, `b = 0.75`:

```
score = Σ_t  IDF(t) · f(t,d)·(k1+1) / ( f(t,d) + k1·(1 - b + b·|d|/avgdl) )
IDF(t) = ln( (N - n(t) + 0.5) / (n(t) + 0.5) + 1 )
```

[REF: src/retrieval/bm25.ts:1-7] [REF: src/retrieval/bm25.ts:27-28]

Tokenization (shared with trigram via `tokenize.ts`) lowercases, splits on
non-alphanumerics, and crucially splits hyphen-joined ids into **both** the
joined token and its parts: `gsd-debug` emits `gsd-debug`, `gsd`, and `debug`.
This lets a plain-word query reach a doc whose id contains `debug`.
[REF: src/retrieval/tokenize.ts:12-25]

### 2. Trigram — typo / substring tolerance

Character-trigram similarity, pg_trgm-style: the query and each chunk are
space-padded (`" " + normalize(s) + " "`) so word boundaries form grams, and
ranked by the **Dice coefficient** `2|∩| / (|Tq| + |Td|)`. This tolerates
typos and substring matches that exact tokenization would miss.
[REF: src/retrieval/trigram.ts:1-5] [REF: src/retrieval/trigram.ts:40]

### 3. Semantic — dense vectors

The precision modality for free-text intent.

- **Embedder.** The "spark" NIM, OpenAI-compatible
  `POST {base}/embeddings` with the model
  `nvidia/llama-nemotron-embed-vl-1b-v2`, producing **2048-dim** vectors. It is
  **asymmetric**: the corpus is embedded with `input_type: "passage"` at build
  time, and the query is embedded with `input_type: "query"` at runtime — the
  query MUST use the same model the corpus was embedded with.
  [REF: src/retrieval/embed.ts:1-5] [REF: src/retrieval/embed.ts:20]
  [REF: src/retrieval/embed.ts:72] [REF: src/retrieval/semantic.ts:15]
- **Vector store.** Primary backend is LanceDB embedded (file-based, in-process);
  the never-fail fallback is a brute-force cosine over a Float32 matrix. Vectors
  are L2-normalized on ingest, so cosine equals dot product and LanceDB's default
  L2 distance ranks identically to cosine.
  [REF: src/retrieval/vectors.ts:1-6]
- **Degenerate-query guard.** A zero-magnitude query vector would cosine-score 0
  against everything and collapse the ranking to an alphabetical tiebreak, so a
  zero vector returns no semantic hits (fusion then falls back to
  lexical+trigram) rather than emitting plausible-looking nonsense.
  [REF: src/retrieval/vectors.ts:32-38]

### 4. RRF — fusion

The fourth modality combines the three ranked lists. See the next section.

---

## Fusion: Reciprocal Rank Fusion

The three modalities produce scores on incompatible scales — BM25 scores, Dice
ratios in [0,1], and cosine distances. Rather than normalize them,
fusion uses **Reciprocal Rank Fusion (RRF)**, which is rank-based: each list
contributes `w / (k + rank)` per item, summed per chunkId. Because it consumes
*ranks*, not raw scores, the three scales merge without any normalization step.
[REF: src/retrieval/fuse.ts:1-5]

### The RRF formula

For a chunk `c`, over all modality lists `i` where the modality weight is `wᵢ`
and `rankᵢ(c)` is the 1-based position of `c` in list `i`:

```
RRF(c) = Σ_i   wᵢ / (k + rankᵢ(c))
```

with the TREC default `k = 60`. A chunk absent from a list contributes nothing
from that list. [REF: src/retrieval/fuse.ts:9-19] [REF: src/retrieval/retrieve.ts:83]

### Weights

Default weights are `[1, 1, 2]` for `[lexical, trigram, semantic]` — semantic is
weighted **×2**. RRF rewards cross-modality consensus and naturally buries a
single-modality strength; but a strong semantic match (the *flaky build →
gsd-debugger* case, where semantic ranks it #1–2 raw while lexical/trigram never
surface it at all) must not be diluted. Weighting semantic ×2 surfaces the
long-tail skill while lexical and trigram still contribute.
[REF: src/retrieval/retrieve.ts:82] [REF: src/retrieval/retrieve.ts:113]

The ×2 weight was tuned by a benchmark weight-sweep (`.planning/BENCHMARK.md`):
the HYBRID arm achieved **MRR 0.562**, **recall@10 83%**, and **long-tail
recall@10 91%**. ×3 had equal recall but lower MRR; ×1 dropped *flaky→debug* out
of the top-K entirely. When semantic is unavailable, weights default to all-ones
over the two remaining lists. [REF: src/retrieval/retrieve.ts:74-83]

### Rollup to doc level

The corpus is chunk-level but the acceptance signal is doc-level (*flaky build →
a debug doc*, not a specific chunk). After fusion, chunk hits are grouped by
`docId` and aggregated with **MAX** (more robust than sum for short long-tail
docs, which sum would under-reward). Each emitted doc result carries the
modalities that surfaced its top chunk. [REF: src/retrieval/rollup.ts:1-6]
[REF: src/retrieval/retrieve.ts:124-125]

### Graceful degradation

BM25 and trigram always run (pure-TS, no external dependency). Semantic runs
only when both the spark endpoint is configured **and** the build's vector
artifact is present. If semantic is unavailable, or if the spark call throws
mid-query, fusion proceeds over lexical+trigram alone — the tool never
hard-fails. A `degraded` flag is surfaced to the caller (see below) so a
fallback ranking is not mistaken for full hybrid.
[REF: src/retrieval/retrieve.ts:2-5] [REF: src/retrieval/retrieve.ts:105-112]

---

## Worked Fusion Example

Suppose three modalities return their top hits for a query, and we focus on two
candidate chunks, `A` and `B`, with `k = 60` and weights `[1, 1, 2]`.

| Modality (weight) | rank of A | rank of B |
|-------------------|-----------|-----------|
| lexical (×1)      | 3         | 1         |
| trigram (×1)      | 5         | 2         |
| semantic (×2)     | 1         | — (absent) |

Chunk **A** (surfaced by all three, ranked #1 by semantic):

```
RRF(A) = 1/(60+3)  +  1/(60+5)  +  2/(60+1)
       = 0.015873  +  0.015385  +  0.032787
       = 0.064045
```

Chunk **B** (strong lexically, but never surfaced by semantic):

```
RRF(B) = 1/(60+1)  +  1/(60+2)  +  0
       = 0.016393  +  0.016129
       = 0.032522
```

`RRF(A) = 0.0640 > RRF(B) = 0.0325`, so **A wins**. The ×2 semantic weight plus
A's #1 semantic rank overcomes B's stronger lexical position — exactly the
mechanism that lets a semantically-relevant long-tail doc (no shared keywords)
beat a keyword-heavy but off-intent doc. After fusion, A's and B's scores roll
up to their parent docs by MAX. [REF: src/retrieval/fuse.ts:9-19]

---

## Incremental Re-indexing

Embedding the full corpus is the expensive build step, so re-embedding is
incremental — driven by a content-hash **merkle manifest** (`manifest.ts`).
[REF: src/retrieval/manifest.ts:1-5]

- Each doc contributes one `sha256` leaf over its (adapted) text.
  [REF: src/retrieval/manifest.ts:10-12]
- `merkleRoot` collapses the sorted leaves into a single value that changes iff
  any doc changes — a fast "did anything change?" check.
  [REF: src/retrieval/manifest.ts:19-32]
- `diffManifest(prev, next)` names exactly which doc ids were
  added / removed / changed / unchanged between two builds.
  [REF: src/retrieval/manifest.ts:53-74]

The vector build feeds the prior build's manifest back in, so `diffManifest`
identifies the changed docs and only **their** chunks are re-embedded; unchanged
docs reuse their cached vectors. [REF: src/retrieval/index-build.ts:1-4]
[REF: src/retrieval/index-build.ts:35-48] [REF: scripts/build-vectors.ts:29-36]

The build reports how many chunks were re-embedded vs reused, e.g.
`re-embedded 12, reused 3700`. [REF: scripts/build-vectors.ts:50-52]

---

## The `gsd_retrieve` Tool (RET-07)

Retrieval is exposed as the `gsd_retrieve` OpenClaw tool. It is registered via
`registerTool`, which means it consumes **zero Discord slash-command slots** —
important because Discord caps global slash commands at 100, so the GSD surface
must go through `toolSearch` + routers rather than per-command slots.
[REF: src/index.ts:267-275]

**Input** (`retrieveParams`): [REF: src/index.ts:60-69]

| Field    | Type             | Description |
|----------|------------------|-------------|
| `intent` | string (required)| Free-text coding/big-work intent. |
| `topK`   | number (optional)| Max results to return (default 8). |

**Output**: an envelope `{ intent, semantic, degraded, results[] }`, where each
result is `{ id, kind, title, score, modality }` — and `modality` is the
**per-result provenance**: the list of modalities (`lexical` / `trigram` /
`semantic`) that surfaced that doc's top chunk (RET-07 criterion 2).
[REF: src/index.ts:286-292] [REF: src/retrieval/retrieve.ts:26-29]

- `semantic` reports whether the spark endpoint was configured at all.
- `degraded` is `true` when semantic was configured but no result carries the
  `semantic` modality — i.e. spark was unreachable and the ranking silently fell
  back to lexical+trigram, so the caller should not trust it as full hybrid.
  [REF: src/index.ts:280-286]

### Input safety

`retrieve()` clamps the intent to 8192 chars (a multi-MB query would block the
event loop in tokenize/trigram — DoS guard) and sanitizes caller-supplied
`topK`/`perModality` bounds (truncate, reject NaN/negatives, clamp to sane
maxima). [REF: src/retrieval/retrieve.ts:97-102]

### Example

```jsonc
// gsd_retrieve  { "intent": "the build is flaky", "topK": 5 }
{
  "intent": "the build is flaky",
  "semantic": true,
  "degraded": false,
  "results": [
    { "id": "agent:gsd-debugger", "kind": "agent",
      "title": "...", "score": 0.0481, "modality": ["semantic"] }
    // ...
  ]
}
```

The lexical and trigram modalities never surface `gsd-debugger` for this query
(no shared tokens); the `["semantic"]` provenance shows it was the dense
modality, weighted ×2, that bridged the gap.

---

## Configuration

The semantic modality reads its endpoint and credentials from the environment —
**nothing is inlined or logged**. [REF: src/retrieval/embed.ts:3-5]

### Endpoint

| Variable                     | Purpose |
|------------------------------|---------|
| `SPARK_EMBEDDINGS_BASE_URL`  | Explicit OpenAI-style base (e.g. `http://spark.example:18091/v1`). Preferred. |
| `SPARK_HOST`                 | Host the gateway exports (e.g. `10.0.0.1` or `spark.example`). A `/v1` path and default port `18091` are appended if absent. |
| `SPARK_PORT`                 | Overrides the default port when deriving from `SPARK_HOST`. |
| `SPARK_EMBEDDINGS_MODEL`     | Overrides the embedding model. Defaults to `nvidia/llama-nemotron-embed-vl-1b-v2` — the model the corpus was embedded with; the query must match it. |

If `SPARK_HOST` carries a scheme, it is kept as-is but normalized to end in a
`/vN` version path so the POST hits `{base}/embeddings`, not the bare root.
[REF: src/retrieval/embed.ts:35-47] [REF: src/retrieval/embed.ts:18-21]

### Credentials

The bearer token is resolved from any of these env names (the OpenClaw gateway
exports the first two; build/dev shells may use the third):

| Variable             | Notes |
|----------------------|-------|
| `SPARK_BEARER_TOKEN` | Gateway-exported. |
| `SPARK_API_KEY`      | Gateway-exported alias. |
| `SPARK_BEARER_AUTH`  | Build/dev shell alias. |

[REF: src/retrieval/embed.ts:27-29]

Semantic search is **available** only when both a base URL *and* a token
resolve; otherwise the engine runs lexical+trigram only and reports `semantic:
false`. [REF: src/retrieval/embed.ts:49-51]

### Building the vectors

The build script (run after `npm run build`) embeds the corpus and writes the
gitignored artifacts shipped in `dist`:

```bash
SPARK_EMBEDDINGS_BASE_URL=http://spark.example:18091/v1 \
  node --experimental-strip-types scripts/build-vectors.ts
```

It fails fast with a clear message if the spark env is missing.
[REF: scripts/build-vectors.ts:6-8] [REF: scripts/build-vectors.ts:44]

> Use a host reachable from your build environment. The examples above
> (`10.0.0.1`, `spark.example`) are placeholders — substitute your own
> endpoint. The token is supplied via the environment, never on the command line
> and never committed.
