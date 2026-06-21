/**
 * RET-05 hybrid orchestrator. Runs BM25 + trigram (always, pure-TS) and semantic (spark+vectors, when
 * the build artifact + spark config are present), fuses the three ranked lists with RRF, and rolls
 * chunk hits up to doc/skill-level results. Graceful degradation: if semantic is unavailable or errors,
 * fusion proceeds over lexical+trigram only — the tool never hard-fails.
 *
 * The "flaky build → gsd-debug" long-tail acceptance (DoD item 5) needs the SEMANTIC modality: "flaky"
 * occurs in zero debug-doc chunks, so lexical+trigram alone cannot bridge it (proven in 09-01).
 */
import { existsSync } from "node:fs";
import { loadCorpus } from "./corpus.js";
import { buildBm25, bm25Search, type Bm25Index, type ScoredChunk } from "./bm25.js";
import { buildTrigram, trigramSearch, type TrigramIndex } from "./trigram.js";
import { rrf } from "./fuse.js";
import { rollup, type DocResult } from "./rollup.js";
import { semanticSearch } from "./semantic.js";
import { embedAvailable, type EmbedOptions } from "./embed.js";
import { CosineBackend, LanceBackend, loadVectorCache, vectorArtifactPaths, type VectorBackend } from "./vectors.js";
import type { GsdCorpus } from "./types.js";

export type SemanticSearcher = (query: string, topK: number) => Promise<ScoredChunk[]>;

/** Index i → modality name; aligns with the `lists` order [bm25, trigram, semantic?]. */
const MODALITIES = ["lexical", "trigram", "semantic"] as const;

/** A retrieved doc plus the source modalities that surfaced its top chunk (RET-07 criterion 2). */
export interface RetrieveResult extends DocResult {
  modalities: string[];
}

let lexCache: { corpus: GsdCorpus; bm: Bm25Index; tg: TrigramIndex } | undefined;
function lexical() {
  if (!lexCache) {
    const corpus = loadCorpus();
    lexCache = { corpus, bm: buildBm25(corpus.chunks), tg: buildTrigram(corpus.chunks) };
  }
  return lexCache;
}

/**
 * The vector backend (loadVectorCache() + optional LanceBackend.open()) is expensive — it reads the
 * 36MB .bin and opens LanceDB — so memoize it ONCE at module level. embedAvailable() is re-checked
 * per call in defaultSemantic() (cheap) so mid-suite env changes still route to the lexical-only path.
 */
let backendCache: VectorBackend | null | undefined; // undefined = not yet attempted
async function semanticBackend(): Promise<VectorBackend | null> {
  if (backendCache !== undefined) return backendCache;
  const cache = loadVectorCache();
  if (!cache) {
    backendCache = null;
    return null;
  }
  let backend: VectorBackend | null = null;
  const { lance } = vectorArtifactPaths();
  if (existsSync(lance)) {
    try {
      backend = await LanceBackend.open(lance);
    } catch {
      backend = null;
    }
  }
  backendCache = backend ?? new CosineBackend(cache);
  return backendCache;
}

/** Default semantic searcher from the build artifact: LanceDB primary, brute-force cosine fallback. null if unavailable. */
export async function defaultSemantic(opts: EmbedOptions = {}): Promise<SemanticSearcher | null> {
  if (!embedAvailable(opts.env)) return null;
  const backend = await semanticBackend();
  if (!backend) return null;
  return (query, topK) => semanticSearch(query, backend, topK, opts);
}

/**
 * Semantic is the precision modality for free-text intent — a strong semantic match (e.g. "flaky build"
 * → gsd-debugger, ranked #1-2 raw) must not be diluted by equal-weight RRF, which rewards cross-modality
 * consensus and buries single-modality strength. Weighting semantic ×2 surfaces the long-tail skill (DoD
 * item 5) while lexical/trigram still contribute (RET-05). Tuned via the BENCH-01 weight sweep: ×2 maximizes
 * MRR (0.562) + long-tail recall@10 (91%) while keeping flaky→debug in topK; ×3 had equal recall but lower
 * MRR, ×1 dropped flaky→debug out of topK entirely. See .planning/BENCHMARK.md.
 */
const SEMANTIC_WEIGHT = 2;
const RRF_K = 60;

export interface RetrieveOptions {
  topK?: number;
  perModality?: number;
  /** undefined → use defaultSemantic(); null → lexical+trigram only; function → injected (tests). */
  semantic?: SemanticSearcher | null;
  /** override fusion weights [bm25, trigram, semantic?]; defaults to [1,1,SEMANTIC_WEIGHT]. */
  weights?: number[];
  /** RRF rank constant; smaller = sharper top-rank emphasis. Default RRF_K. */
  k?: number;
  env?: NodeJS.ProcessEnv;
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<RetrieveResult[]> {
  // Clamp the intent length (SECURITY/DoS): a multi-MB query blocks the event loop in tokenize/trigram.
  const q = query.length > 8192 ? query.slice(0, 8192) : query;
  // Sanitize caller-supplied bounds (cross-AI F4): clamp to sane integer ranges, no NaN/negatives/huge.
  const topK = Math.max(1, Math.min(Math.trunc(opts.topK ?? 10) || 10, 100));
  const perMod = Math.max(1, Math.min(Math.trunc(opts.perModality ?? 50) || 50, 200));
  const { corpus, bm, tg } = lexical();
  const lists: ScoredChunk[][] = [bm25Search(bm, q, perMod), trigramSearch(tg, q, perMod)];
  // BLOCKER #1: the WHOLE semantic path must degrade gracefully — defaultSemantic() loads the vector cache, whose
  // JSON.parse can THROW on a corrupt/truncated artifact. That throw was OUTSIDE the try, so retrieve() hard-failed
  // (returning zero results) instead of falling back to lexical+trigram — violating the "never hard-fails" contract.
  try {
    const sem = opts.semantic === undefined ? await defaultSemantic({ env: opts.env }) : opts.semantic;
    if (sem) lists.push(await sem(q, perMod));
  } catch {
    /* graceful degradation — lexical + trigram still rank */
  }
  const weights = opts.weights ?? (lists.length === 3 ? [1, 1, SEMANTIC_WEIGHT] : lists.map(() => 1));
  // Track which modality(ies) surfaced each chunk so results carry source provenance (RET-07 criterion 2).
  const modByChunk = new Map<string, Set<string>>();
  lists.forEach((list, i) => {
    const mod = MODALITIES[i];
    for (const h of list) {
      let s = modByChunk.get(h.chunkId);
      if (!s) modByChunk.set(h.chunkId, (s = new Set<string>()));
      s.add(mod);
    }
  });
  const docs = rollup(rrf(lists, opts.k ?? RRF_K, weights), corpus).slice(0, topK);
  // #4: union the modalities across ALL of the doc's contributing chunks, not just topChunkId — otherwise a doc
  // that semantic surfaced but which lost the per-doc top-chunk race to lexical dropped "semantic" from its
  // modalities, producing a FALSE `degraded` signal even when semantic was fully operational.
  return docs.map((d) => {
    const mods = new Set<string>();
    for (const cid of d.chunkIds) for (const m of modByChunk.get(cid) ?? []) mods.add(m);
    return { ...d, modalities: [...mods] };
  });
}
