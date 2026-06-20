/**
 * Reciprocal-rank fusion (RET-05). Each ranked list contributes w/(k + rank) per item
 * (1-based rank, k=60 TREC default); contributions sum per chunkId. RRF is rank-based
 * precisely so BM25 scores, Dice ratios, and cosine distances — which are not on the
 * same scale — can be merged without normalization (L6). Equal weights by default.
 */
import type { ScoredChunk } from "./bm25.js";

export function rrf(lists: ScoredChunk[][], k = 60, weights?: number[]): ScoredChunk[] {
  const scores = new Map<string, number>();

  lists.forEach((list, i) => {
    const w = weights?.[i] ?? 1;
    list.forEach((hit, idx) => {
      const rank = idx + 1;
      const contrib = w / (k + rank);
      scores.set(hit.chunkId, (scores.get(hit.chunkId) ?? 0) + contrib);
    });
  });

  const out: ScoredChunk[] = [];
  for (const [chunkId, score] of scores) out.push({ chunkId, score });
  out.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));
  return out;
}
