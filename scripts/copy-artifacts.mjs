/**
 * Post-build: copy the gitignored retrieval artifacts from src/retrieval/ into dist/retrieval/ so the
 * shipped plugin is self-contained (RET-01) — at runtime the loaders read these bundled copies next to
 * the compiled module, never the dev source tree or any external CLI dir. Tolerant: copies what exists.
 */
import { existsSync, mkdirSync, copyFileSync, cpSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "retrieval");
const dst = join(root, "dist", "retrieval");
mkdirSync(dst, { recursive: true });

const files = ["corpus.generated.json", "vectors.generated.bin", "vectors.index.json", "vectors.manifest.json"];
const copied = [];
for (const f of files) {
  const s = join(src, f);
  if (existsSync(s)) {
    copyFileSync(s, join(dst, f));
    copied.push(`${f} (${(statSync(s).size / 1024 / 1024).toFixed(1)}M)`);
  }
}
const lanceSrc = join(src, "lancedb");
if (existsSync(lanceSrc)) {
  cpSync(lanceSrc, join(dst, "lancedb"), { recursive: true });
  copied.push("lancedb/");
}
console.log(`copy-artifacts -> dist/retrieval: ${copied.join(", ") || "(none present yet — run build-corpus + build-vectors)"}`);
