/**
 * Build-time vector generator (RET-02/RET-06 — NOT a runtime dependency; mirrors build-corpus.ts).
 * Embeds the bundled corpus via the spark NIM (input_type "passage") and writes two gitignored
 * artifacts shipped in dist: a Float32 vector matrix (vectors.generated.bin + vectors.index.json) and a
 * LanceDB table (lancedb/). Incremental: a prior vectors cache is reused for unchanged chunks (RET-06).
 *
 * Run (point the base URL at a reachable spark endpoint; token from env, never inlined):
 *   SPARK_EMBEDDINGS_BASE_URL=http://10.0.0.1:18091/v1 node --experimental-strip-types scripts/build-vectors.ts
 */
// Imports the COMPILED dist modules (real .js) so this strip-types script resolves the full value-import
// graph (src/*.ts cross-import with .js, which strip-types can't resolve). Run `npm run build` first.
import { basename } from "node:path";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { loadCorpus } from "../dist/retrieval/corpus.js";
import { buildVectors } from "../dist/retrieval/index-build.js";
import { embedTexts, sparkConfig } from "../dist/retrieval/embed.js";
import { writeVectorCache, writeLanceTable, vectorArtifactPaths, loadVectorCache } from "../dist/retrieval/vectors.js";

export async function generateVectors(): Promise<{ rows: number; dim: number; reembedded: number; reused: number }> {
  const corpus = loadCorpus();
  const paths = vectorArtifactPaths();
  const prior = loadVectorCache();
  const cache = new Map<string, number[]>();
  if (prior) {
    for (let r = 0; r < prior.chunkIds.length; r++) {
      cache.set(prior.chunkIds[r], Array.from(prior.matrix.subarray(r * prior.dim, (r + 1) * prior.dim)));
    }
  }
  // RET-06: feed back the PRIOR build's manifest so diffManifest re-embeds only changed docs.
  const prevManifest = existsSync(paths.manifest) ? JSON.parse(readFileSync(paths.manifest, "utf8")) : null;
  const result = await buildVectors({
    corpus,
    embed: (texts, inputType) => embedTexts(texts, inputType),
    cache,
    prevManifest,
  });
  writeVectorCache(result.rows.map((r) => ({ chunkId: r.chunkId, vector: r.vector })));
  await writeLanceTable(paths.lance, result.rows);
  writeFileSync(paths.manifest, JSON.stringify(result.manifest));
  return { rows: result.rows.length, dim: result.rows[0]?.vector.length ?? 0, reembedded: result.reembedded, reused: result.reused };
}

if (process.argv[1] && basename(process.argv[1]) === "build-vectors.ts") {
  sparkConfig(); // fail fast with a clear message if spark env is missing
  generateVectors()
    .then((r) => {
      const p = vectorArtifactPaths();
      const bytes = statSync(p.bin).size;
      process.stdout.write(
        `vectors → ${p.bin}\n` +
          `  rows: ${r.rows}  dim: ${r.dim}  (re-embedded ${r.reembedded}, reused ${r.reused})\n` +
          `  bin: ${(bytes / 1024 / 1024).toFixed(1)} MiB  lancedb: ${p.lance}\n`,
      );
    })
    .catch((err) => {
      process.stderr.write(`build-vectors failed: ${err?.message ?? err}\n`);
      process.exit(1);
    });
}
