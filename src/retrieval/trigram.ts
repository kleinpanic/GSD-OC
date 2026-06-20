/**
 * Pure-TS character-trigram similarity (RET-04) for typo/substring tolerance.
 * Trigrams of `" "+normalize(s)+" "` (pg_trgm-style space padding so word
 * boundaries form grams); ranked by Dice coefficient 2|∩|/(|Tq|+|Td|).
 */
import { normalize } from "./tokenize.js";
import type { GsdChunk } from "./types.js";
import type { ScoredChunk } from "./bm25.js";

export interface TrigramIndex {
  /** chunkId -> its trigram set. */
  sets: Map<string, Set<string>>;
}

export function trigrams(s: string): Set<string> {
  const padded = " " + normalize(s) + " ";
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

export function buildTrigram(chunks: GsdChunk[]): TrigramIndex {
  const sets = new Map<string, Set<string>>();
  for (const chunk of chunks) sets.set(chunk.id, trigrams(chunk.text));
  return { sets };
}

export function trigramSearch(index: TrigramIndex, query: string, topK: number): ScoredChunk[] {
  const tq = trigrams(query);
  const out: ScoredChunk[] = [];
  if (tq.size === 0) return out;

  for (const [chunkId, td] of index.sets) {
    let inter = 0;
    const [small, large] = tq.size <= td.size ? [tq, td] : [td, tq];
    for (const g of small) if (large.has(g)) inter++;
    if (inter === 0) continue;
    const score = (2 * inter) / (tq.size + td.size);
    out.push({ chunkId, score });
  }

  out.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));
  return out.slice(0, topK);
}
