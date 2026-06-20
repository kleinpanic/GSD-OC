/**
 * RET-06 incremental vector build. Given the corpus and the previous build's manifest + vector cache,
 * re-embed only the chunks of docs that were added/changed (diffManifest); unchanged docs reuse their
 * cached vectors. Embedding is injected (the real spark embedder at build time, a counting mock in tests).
 */
import type { CorpusManifest, GsdChunk, GsdCorpus } from "./types.js";
import { diffManifest } from "./manifest.js";
import type { InputType } from "./embed.js";

export type Embedder = (texts: string[], inputType: InputType) => Promise<number[][]>;

export interface VectorRow {
  chunkId: string;
  docId: string;
  vector: number[];
}

export interface BuildResult {
  rows: VectorRow[];
  manifest: CorpusManifest;
  reembedded: number;
  reused: number;
}

export async function buildVectors(opts: {
  corpus: GsdCorpus;
  embed: Embedder;
  prevManifest?: CorpusManifest | null;
  cache?: Map<string, number[]> | null;
}): Promise<BuildResult> {
  const { corpus, embed } = opts;
  const cache = opts.cache ?? new Map<string, number[]>();
  const next = corpus.manifest;

  let reembedDocIds: Set<string>;
  if (opts.prevManifest) {
    const d = diffManifest(opts.prevManifest, next);
    reembedDocIds = new Set([...d.added, ...d.changed]);
  } else {
    reembedDocIds = new Set(corpus.docs.map((doc) => doc.id));
  }

  const toEmbed: GsdChunk[] = corpus.chunks.filter((ch) => reembedDocIds.has(ch.docId) || !cache.has(ch.id));
  if (toEmbed.length > 0) {
    const vecs = await embed(toEmbed.map((c) => c.text), "passage");
    if (vecs.length !== toEmbed.length) throw new Error(`embedder returned ${vecs.length} vectors for ${toEmbed.length} chunks`);
    toEmbed.forEach((c, i) => cache.set(c.id, vecs[i]));
  }

  const rows: VectorRow[] = corpus.chunks.map((ch) => ({ chunkId: ch.id, docId: ch.docId, vector: cache.get(ch.id)! }));
  return { rows, manifest: next, reembedded: toEmbed.length, reused: rows.length - toEmbed.length };
}
