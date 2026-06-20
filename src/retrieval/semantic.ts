/**
 * RET-02 semantic search: embed the free-text query (input_type "query") via spark, then ANN/cosine
 * search the vector backend. Returns ranked chunk hits to be fused with BM25/trigram.
 */
import { embedTexts, type EmbedOptions } from "./embed.js";
import type { ScoredChunk } from "./bm25.js";
import type { VectorBackend } from "./vectors.js";

export async function semanticSearch(
  query: string,
  backend: VectorBackend,
  topK: number,
  opts: EmbedOptions = {},
): Promise<ScoredChunk[]> {
  const [vec] = await embedTexts([query], "query", opts);
  if (!vec) return [];
  return backend.search(vec, topK);
}
