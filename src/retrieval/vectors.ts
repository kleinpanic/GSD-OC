/**
 * RET-02 vector store. Primary backend = LanceDB embedded (file-based, in-process); fallback =
 * brute-force cosine over a Float32 matrix (the never-fail path at 4657 vectors — research fallback #3).
 * Vectors are L2-normalized on ingest so cosine == dot product and LanceDB's default L2 distance ranks
 * identically to cosine.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as lancedb from "@lancedb/lancedb";
import type { ScoredChunk } from "./bm25.js";

export interface VectorCache {
  dim: number;
  chunkIds: string[];
  /** row-major, length === chunkIds.length * dim, each row L2-normalized */
  matrix: Float32Array;
}

export function normalizeInto(v: number[] | Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export interface VectorBackend {
  search(query: number[], topK: number): Promise<ScoredChunk[]>;
}

/** Brute-force cosine over the in-memory normalized matrix. */
export class CosineBackend implements VectorBackend {
  private readonly cache: VectorCache;
  constructor(cache: VectorCache) {
    this.cache = cache;
  }
  async search(query: number[], topK: number): Promise<ScoredChunk[]> {
    const { dim, chunkIds, matrix } = this.cache;
    const q = normalizeInto(query);
    const scored: ScoredChunk[] = [];
    for (let r = 0; r < chunkIds.length; r++) {
      const base = r * dim;
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += q[i] * matrix[base + i];
      scored.push({ chunkId: chunkIds[r], score: dot });
    }
    scored.sort((a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : 1));
    return scored.slice(0, topK);
  }
}

/** LanceDB-backed search. Open with `LanceBackend.open(dir)`; throws if the table is absent. */
export class LanceBackend implements VectorBackend {
  private readonly tbl: lancedb.Table;
  private constructor(tbl: lancedb.Table) {
    this.tbl = tbl;
  }
  static async open(dir: string, table = "chunks"): Promise<LanceBackend> {
    const db = await lancedb.connect(dir);
    return new LanceBackend(await db.openTable(table));
  }
  async search(query: number[], topK: number): Promise<ScoredChunk[]> {
    const q = Array.from(normalizeInto(query));
    const rows = (await this.tbl.search(q).limit(topK).toArray()) as { chunkId?: string; id?: string; _distance?: number }[];
    return rows.map((r) => ({ chunkId: (r.chunkId ?? r.id) as string, score: -(r._distance ?? 0) }));
  }
}

/** Build (overwrite) the LanceDB "chunks" table from normalized rows. Build-time use. */
export async function writeLanceTable(
  dir: string,
  rows: { chunkId: string; docId: string; vector: number[] }[],
  table = "chunks",
): Promise<void> {
  const db = await lancedb.connect(dir);
  const data = rows.map((r) => ({ chunkId: r.chunkId, docId: r.docId, vector: Array.from(normalizeInto(r.vector)) }));
  await db.createTable(table, data, { mode: "overwrite" });
}

/* ---- Build-artifact (gitignored, shipped in dist) location + (de)serialization ---- */

function retrievalDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return join(dir, "src", "retrieval");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("vectors: could not locate repo root from " + import.meta.url);
}

export function vectorArtifactPaths(): { bin: string; index: string; lance: string; manifest: string } {
  const d = retrievalDir();
  return {
    bin: join(d, "vectors.generated.bin"),
    index: join(d, "vectors.index.json"),
    lance: join(d, "lancedb"),
    manifest: join(d, "vectors.manifest.json"),
  };
}

/** Load the normalized vector matrix from the build artifact, or null if not built yet. */
export function loadVectorCache(paths: { bin: string; index: string } = vectorArtifactPaths()): VectorCache | null {
  if (!existsSync(paths.bin) || !existsSync(paths.index)) return null;
  const idx = JSON.parse(readFileSync(paths.index, "utf8")) as { dim: number; chunkIds: string[] };
  const buf = readFileSync(paths.bin);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { dim: idx.dim, chunkIds: idx.chunkIds, matrix: new Float32Array(ab) };
}

/** Persist normalized vectors as a Float32 .bin + a chunkId index (build-time). */
export function writeVectorCache(
  rows: { chunkId: string; vector: number[] }[],
  paths: { bin: string; index: string } = vectorArtifactPaths(),
): void {
  const dim = rows[0]?.vector.length ?? 0;
  const matrix = new Float32Array(rows.length * dim);
  rows.forEach((r, ri) => matrix.set(normalizeInto(r.vector), ri * dim));
  mkdirSync(dirname(paths.bin), { recursive: true });
  writeFileSync(paths.bin, Buffer.from(matrix.buffer, matrix.byteOffset, matrix.byteLength));
  writeFileSync(paths.index, JSON.stringify({ dim, chunkIds: rows.map((r) => r.chunkId) }));
}
