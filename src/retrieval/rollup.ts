/**
 * Chunk hits -> doc/skill results. The corpus is chunk-level but the acceptance signal
 * is doc-level ("the build is flaky" -> a debug doc), so fused chunk scores are grouped
 * by docId and aggregated with MAX (more robust than sum for short long-tail docs, which
 * sum would under-reward). Emits {docId, kind, title, score, topChunkId} sorted desc.
 */
import type { GsdCorpus, GsdDocKind } from "./types.js";
import type { ScoredChunk } from "./bm25.js";

export interface DocResult {
  docId: string;
  kind: GsdDocKind;
  title: string;
  score: number;
  topChunkId: string;
  /** EVERY chunk of this doc that appeared in the fused results — so a caller can union the modalities that
   *  contributed to the doc, not just those on topChunkId (#4: a doc surfaced by semantic that LOST the top-chunk
   *  race to lexical otherwise dropped "semantic" from its modalities → a false `degraded` signal). */
  chunkIds: string[];
}

export function rollup(fusedChunks: ScoredChunk[], corpus: GsdCorpus): DocResult[] {
  const byId = new Map<string, GsdCorpus["chunks"][number]>();
  for (const chunk of corpus.chunks) byId.set(chunk.id, chunk);

  const best = new Map<string, DocResult>();
  for (const { chunkId, score } of fusedChunks) {
    const chunk = byId.get(chunkId);
    if (!chunk) continue;
    const cur = best.get(chunk.docId);
    if (!cur) {
      best.set(chunk.docId, { docId: chunk.docId, kind: chunk.kind, title: chunk.title, score, topChunkId: chunk.id, chunkIds: [chunk.id] });
    } else {
      cur.chunkIds.push(chunk.id); // record every contributing chunk for the modality union (#4)
      if (score > cur.score) {
        cur.score = score;
        cur.topChunkId = chunk.id;
        cur.title = chunk.title;
      }
    }
  }

  const out = [...best.values()];
  out.sort((a, b) => (b.score - a.score) || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
  return out;
}
