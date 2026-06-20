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

export interface RetrieveOptions {
  topK?: number;
  perModality?: number;
  /** undefined → use defaultSemantic(); null → lexical+trigram only; function → injected (tests). */
  semantic?: SemanticSearcher | null;
  /** override fusion weights [bm25, trigram, semantic?]; defaults to [1,1,SEMANTIC_WEIGHT]. */
  weights?: number[];
  env?: NodeJS.ProcessEnv;
}

export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<DocResult[]> {
  const topK = opts.topK ?? 10;
  const perMod = opts.perModality ?? 50;
  const { corpus, bm, tg } = lexical();
  const lists: ScoredChunk[][] = [bm25Search(bm, query, perMod), trigramSearch(tg, query, perMod)];
  const sem = opts.semantic === undefined ? await defaultSemantic({ env: opts.env }) : opts.semantic;
  if (sem) {
    try {
      lists.push(await sem(query, perMod));
    } catch {
      /* graceful degradation */
    }
  }
  const weights = opts.weights ?? (lists.length === 3 ? [1, 1, SEMANTIC_WEIGHT] : lists.map(() => 1));
  return rollup(rrf(lists, 60, weights), corpus).slice(0, topK);
}
