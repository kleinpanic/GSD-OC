/**
 * Loads the bundled corpus (RET-01). `corpus.generated.json` is a build artifact
 * (gitignored, ~6 MB) emitted by scripts/build-corpus.ts at src/retrieval/. It is
 * read via readFileSync rather than a JSON import so the loader compiles under both
 * tsconfig.json and tsconfig.test.json without resolveJsonModule and without inlining
 * a multi-MB literal into the build.
 *
 * tsc does not copy the JSON into dist/ or dist-test/, so import.meta.url-relative
 * resolution would miss it. Instead walk up from this module to the repo root (the
 * directory containing package.json) and read the canonical src/retrieval copy — this
 * resolves identically whether the compiled module lives in dist/retrieval/ or
 * dist-test/src/retrieval/.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GsdCorpus } from "./types.js";

let cached: GsdCorpus | undefined;

function corpusPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) {
      return join(dir, "src", "retrieval", "corpus.generated.json");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("loadCorpus: could not locate repo root from " + import.meta.url);
}

export function loadCorpus(): GsdCorpus {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(corpusPath(), "utf8")) as GsdCorpus;
  return cached;
}
