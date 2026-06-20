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
}

export function rollup(fusedChunks: ScoredChunk[], corpus: GsdCorpus): DocResult[] {
  const byId = new Map<string, GsdCorpus["chunks"][number]>();
  for (const chunk of corpus.chunks) byId.set(chunk.id, chunk);

  const best = new Map<string, DocResult>();
  for (const { chunkId, score } of fusedChunks) {
    const chunk = byId.get(chunkId);
    if (!chunk) continue;
    const cur = best.get(chunk.docId);
    if (!cur || score > cur.score) {
      best.set(chunk.docId, {
        docId: chunk.docId,
        kind: chunk.kind,
        title: chunk.title,
        score,
        topChunkId: chunk.id,
      });
    }
  }

  const out = [...best.values()];
  out.sort((a, b) => (b.score - a.score) || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
  return out;
}
