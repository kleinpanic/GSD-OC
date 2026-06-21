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
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) throw new Error("non-finite vector component");
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** MED-02: a zero-magnitude query vector cosine-scores 0 against everything → the ranking collapses to the
 *  chunkId tiebreak (alphabetical garbage). Detect it at the query boundary so search returns no semantic
 *  hits (fusion falls back to lexical+trigram) rather than emitting plausible-looking nonsense. */
function isZeroVector(v: number[]): boolean {
  // BLOCKER (#2): check zero MAGNITUDE, not per-component `!== 0`. A denormal/tiny vector (all `1e-300`) has
  // non-zero components but its squared norm underflows to 0 → normalizeInto would emit an ALL-ZERO unit vector
  // that collapses cosine ranking to the alphabetical tiebreak. Summing squares catches true-zero AND underflow.
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  return norm === 0;
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
    if (query.length !== dim) throw new Error(`query dim ${query.length} != index dim ${dim}`);
    if (isZeroVector(query)) return []; // MED-02: no garbage ranking from a degenerate query
    const q = normalizeInto(query);
    const scored: ScoredChunk[] = [];
    for (let r = 0; r < chunkIds.length; r++) {
      const base = r * dim;
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += q[i] * matrix[base + i];
      // WARNING fix: a corrupt stored row (NaN/Infinity that passed the %4 + length guards) yields a non-finite
      // dot, and `b.score - a.score` on a NaN makes the comparator inconsistent → a partially-unsorted ranking.
      // DROP the bad row instead of letting it poison the whole result order.
      if (Number.isFinite(dot)) scored.push({ chunkId: chunkIds[r], score: dot });
    }
    scored.sort((a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : 1));
    return scored.slice(0, Math.max(0, topK));
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
    if (isZeroVector(query)) return []; // MED-02
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

/* ---- Build-artifact location + (de)serialization ----
 * WRITE goes to the source repo (src/retrieval/, gitignored); the build copies artifacts into
 * dist/retrieval/. READ prefers the copy bundled next to the compiled module (dist/retrieval/) so the
 * runtime is self-contained (RET-01), falling back to the source copy in dev/test. */

function sourceRetrievalDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return join(dir, "src", "retrieval");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("vectors: could not locate repo root from " + import.meta.url);
}

function bundledRetrievalDir(): string {
  const local = dirname(fileURLToPath(import.meta.url));
  if (existsSync(join(local, "vectors.index.json")) || existsSync(join(local, "lancedb"))) return local;
  return sourceRetrievalDir();
}

export function vectorArtifactPaths(forWrite = false): { bin: string; index: string; lance: string; manifest: string } {
  const d = forWrite ? sourceRetrievalDir() : bundledRetrievalDir();
  return {
    bin: join(d, "vectors.generated.bin"),
    index: join(d, "vectors.index.json"),
    lance: join(d, "lancedb"),
    manifest: join(d, "vectors.manifest.json"),
  };
}

/** Load the normalized vector matrix from the bundled (runtime) artifact, or null if not built yet. */
export function loadVectorCache(paths: { bin: string; index: string } = vectorArtifactPaths(false)): VectorCache | null {
  if (!existsSync(paths.bin) || !existsSync(paths.index)) return null;
  // BLOCKER #1 (defense-in-depth): guard the parse — a corrupt/truncated index.json must return null (degrade),
  // not throw a SyntaxError up through retrieve(). Mirrors loadCorpus's guarded parse + the MED-01 binary guards.
  let idx: { dim: number; chunkIds: string[] };
  try {
    idx = JSON.parse(readFileSync(paths.index, "utf8")) as { dim: number; chunkIds: string[] };
  } catch {
    return null;
  }
  const buf = readFileSync(paths.bin);
  // MED-01: a truncated/corrupt .bin must return null, not crash. new Float32Array throws on a byteLength
  // not divisible by 4; guard that, and reject a degenerate (dim<=0 / non-array) index that would otherwise
  // yield a 0-length backend that throws confusingly at query time.
  if (buf.byteLength % 4 !== 0) return null;
  if (!(idx.dim > 0) || !Array.isArray(idx.chunkIds)) return null;
  const matrix = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); // view, no copy, alignment-safe
  if (matrix.length !== idx.dim * idx.chunkIds.length) return null; // truncated/mismatched artifact (e.g. partial copy)
  return { dim: idx.dim, chunkIds: idx.chunkIds, matrix };
}

/** Persist normalized vectors as a Float32 .bin + a chunkId index (build-time). */
export function writeVectorCache(
  rows: { chunkId: string; vector: number[] }[],
  paths: { bin: string; index: string } = vectorArtifactPaths(true),
): void {
  const dim = rows[0]?.vector.length ?? 0;
  const matrix = new Float32Array(rows.length * dim);
  rows.forEach((r, ri) => matrix.set(normalizeInto(r.vector), ri * dim));
  mkdirSync(dirname(paths.bin), { recursive: true });
  writeFileSync(paths.bin, Buffer.from(matrix.buffer, matrix.byteOffset, matrix.byteLength));
  writeFileSync(paths.index, JSON.stringify({ dim, chunkIds: rows.map((r) => r.chunkId) }));
}
