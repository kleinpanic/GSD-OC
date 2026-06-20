/**
 * Dev-time corpus generator (RET-01 — NOT a runtime dependency, mirrors
 * scripts/port-agents.ts). Snapshots the full GSD surface from ~/.claude into a
 * single bundled JSON so the runtime reads the plugin's OWN data, never ~/.claude
 * (preserves R0.1/R0.3). Chunks every doc and stamps a merkle manifest (RET-06).
 *
 * Run:  node --experimental-strip-types scripts/build-corpus.ts
 * Emits: src/retrieval/corpus.generated.json  (gitignored build artifact, shipped in dist)
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname, basename, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GsdDoc, GsdDocKind, GsdCorpus } from "../src/retrieval/types.ts";
import { chunkDoc } from "../src/retrieval/chunk.ts";
import { buildManifest, sha256 } from "../src/retrieval/manifest.ts";
import { detectGsdInstall, safeList } from "../src/retrieval/detect.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const OUT = join(REPO_ROOT, "src", "retrieval", "corpus.generated.json");

interface Source {
  kind: GsdDocKind;
  root: string;
  recursive: boolean;
  filter: (f: string) => boolean;
}

function sources(): Source[] {
  const install = detectGsdInstall();
  if (!install) {
    throw new Error(
      "no GSD install detected — probed claude/codex/opencode/gemini/pi/hermes/cursor/copilot homes for gsd-core/workflows",
    );
  }
  return install.docRoots.map((d) => ({
    kind: d.kind,
    root: d.root,
    recursive: d.recursive,
    filter: d.kind === "agent" ? (f: string) => f.startsWith("gsd-") && f.endsWith(".md") : (f: string) => f.endsWith(".md"),
  }));
}

function titleOf(text: string, fallback: string): string {
  for (const line of text.split("\n")) {
    const m = /^#{1,3}\s+(.*\S)\s*$/.exec(line);
    if (m) return m[1];
  }
  return fallback;
}

function buildDocs(srcs: Source[]): GsdDoc[] {
  const docs: GsdDoc[] = [];
  for (const src of srcs) {
    const files = safeList(src.root, src.recursive).filter((f) => src.filter(basename(f)));
    if (files.length === 0) throw new Error(`no ${src.kind} sources found under ${src.root}`);
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      const rel = relative(src.root, path).replace(extname(path), "");
      const id = `${src.kind}:${rel}`;
      docs.push({ id, kind: src.kind, path, title: titleOf(text, basename(path)), text, sha256: sha256(text) });
    }
  }
  return docs;
}

export function generateCorpus(): GsdCorpus {
  const srcs = sources();
  const docs = buildDocs(srcs);
  const chunks = docs.flatMap((d) => chunkDoc(d));
  const roots = srcs.map((s) => s.root);
  const manifest = buildManifest(docs, chunks, roots);
  return { docs, chunks, manifest };
}

if (process.argv[1] && basename(process.argv[1]) === "build-corpus.ts") {
  const corpus = generateCorpus();
  writeFileSync(OUT, JSON.stringify(corpus), "utf8");
  const byKind = (k: GsdDocKind) => corpus.docs.filter((d) => d.kind === k).length;
  const bytes = statSync(OUT).size;
  process.stdout.write(
    `corpus → ${OUT}\n` +
      `  docs: ${corpus.manifest.docCount} ` +
      `(workflow=${byKind("workflow")} agent=${byKind("agent")} reference=${byKind("reference")} template=${byKind("template")})\n` +
      `  chunks: ${corpus.manifest.chunkCount}\n` +
      `  merkleRoot: ${corpus.manifest.merkleRoot}\n` +
      `  size: ${(bytes / 1024).toFixed(0)} KiB\n`,
  );
  if (corpus.manifest.docCount < 200) {
    throw new Error(`expected >= 200 docs, got ${corpus.manifest.docCount} — source roots incomplete`);
  }
}
