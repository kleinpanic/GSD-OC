/**
 * Pure-TS Okapi BM25 over chunk text (RET-03). Standard scoring with Lucene defaults
 * k1=1.2, b=0.75:
 *   score = Σ_t IDF(t) · f(t,d)·(k1+1) / ( f(t,d) + k1·(1 - b + b·|d|/avgdl) )
 *   IDF(t) = ln( (N - n(t) + 0.5) / (n(t) + 0.5) + 1 )
 * Tokenization (incl. hyphen sub-token split) comes from tokenize.ts.
 */
import { tokenize } from "./tokenize.js";
import type { GsdChunk } from "./types.js";

export interface Bm25Index {
  /** term -> document frequency n(t). */
  df: Map<string, number>;
  /** term -> [chunkId, termFreq][]. */
  postings: Map<string, [string, number][]>;
  /** chunkId -> token length |d|. */
  docLen: Map<string, number>;
  avgdl: number;
  n: number;
}

export interface ScoredChunk {
  chunkId: string;
  score: number;
}

const K1 = 1.2;
const B = 0.75;

export function buildBm25(chunks: GsdChunk[]): Bm25Index {
  const df = new Map<string, number>();
  const postings = new Map<string, [string, number][]>();
  const docLen = new Map<string, number>();
  let total = 0;

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    docLen.set(chunk.id, tokens.length);
    total += tokens.length;

    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    for (const [term, freq] of tf) {
      df.set(term, (df.get(term) ?? 0) + 1);
      let list = postings.get(term);
      if (!list) {
        list = [];
        postings.set(term, list);
      }
      list.push([chunk.id, freq]);
    }
  }

  const n = chunks.length;
  return { df, postings, docLen, avgdl: n ? total / n : 0, n };
}

export function bm25Search(index: Bm25Index, query: string, topK: number): ScoredChunk[] {
  const scores = new Map<string, number>();
  const queryTerms = new Set(tokenize(query));

  for (const term of queryTerms) {
    const nt = index.df.get(term);
    if (!nt) continue;
    const idf = Math.log((index.n - nt + 0.5) / (nt + 0.5) + 1);
    for (const [chunkId, freq] of index.postings.get(term)!) {
      const dl = index.docLen.get(chunkId) ?? 0;
      const denom = freq + K1 * (1 - B + (B * dl) / (index.avgdl || 1));
      const contrib = idf * ((freq * (K1 + 1)) / denom);
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + contrib);
    }
  }

  return rankDesc(scores, topK);
}

function rankDesc(scores: Map<string, number>, topK: number): ScoredChunk[] {
  const out: ScoredChunk[] = [];
  for (const [chunkId, score] of scores) out.push({ chunkId, score });
  out.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));
  return out.slice(0, topK);
}
