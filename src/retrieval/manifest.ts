/**
 * Content-hash + merkle manifest (RET-06). Each doc contributes one sha256 leaf;
 * the merkle root collapses all leaves into a single value that changes iff any doc
 * changes — so a build can skip re-embedding when the root matches the cached one,
 * and `diffManifest` names exactly which docs to re-process.
 */
import { createHash } from "node:crypto";
import type { GsdDoc, GsdChunk, CorpusManifest, ManifestLeaf, ManifestDiff } from "./types.js";

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Binary merkle root over the given leaves. Leaves are sorted first so the root is
 * order-independent (manifest is keyed by id, not insertion order). Odd nodes promote.
 * Empty input hashes the empty string so the root is always defined.
 */
export function merkleRoot(leaves: string[]): string {
  let level = [...leaves].sort();
  if (level.length === 0) return sha256("");
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i]; // promote odd
      next.push(sha256(a + b));
    }
    level = next;
  }
  return level[0];
}

/** Build the manifest from the doc set (chunkCount is carried for provenance). */
export function buildManifest(
  docs: GsdDoc[],
  chunks: GsdChunk[],
  generatedFrom: string[],
): CorpusManifest {
  const leaves: ManifestLeaf[] = docs
    .map((d) => ({ id: d.id, sha256: d.sha256 }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    generatedFrom,
    docCount: docs.length,
    chunkCount: chunks.length,
    merkleRoot: merkleRoot(leaves.map((l) => l.sha256)),
    docs: leaves,
  };
}

/** Which doc ids were added / removed / changed / unchanged between two manifests. */
export function diffManifest(prev: CorpusManifest, next: CorpusManifest): ManifestDiff {
  const prevById = new Map(prev.docs.map((l) => [l.id, l.sha256]));
  const nextById = new Map(next.docs.map((l) => [l.id, l.sha256]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [id, hash] of nextById) {
    if (!prevById.has(id)) added.push(id);
    else if (prevById.get(id) !== hash) changed.push(id);
    else unchanged.push(id);
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) removed.push(id);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    unchanged: unchanged.sort(),
  };
}
