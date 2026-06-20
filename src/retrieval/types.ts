/**
 * Retrieval corpus types (v1.1 RET-01/RET-06). A "doc" is one source markdown file
 * from the GSD surface (workflow / agent / reference / template); a "chunk" is a
 * heading-bounded, size-bounded slice used as a retrieval unit. The manifest is the
 * content-hash + merkle record that drives incremental re-index.
 */

export type GsdDocKind = "workflow" | "agent" | "reference" | "template";

export interface GsdDoc {
  /** Stable id: `${kind}:${relpath-without-ext}` (e.g. "workflow:plan-phase"). */
  id: string;
  kind: GsdDocKind;
  /** Source path the doc was snapshotted from (provenance only — not read at runtime). */
  path: string;
  title: string;
  text: string;
  /** sha256 of `text` — the manifest leaf. */
  sha256: string;
}

export interface GsdChunk {
  /** `${docId}#${ordinal}`. */
  id: string;
  docId: string;
  kind: GsdDocKind;
  title: string;
  /** Nearest enclosing markdown heading text (or the doc title for the lead chunk). */
  heading: string;
  ordinal: number;
  text: string;
}

export interface ManifestLeaf {
  id: string;
  sha256: string;
}

export interface CorpusManifest {
  /** Source roots the corpus was built from (provenance). */
  generatedFrom: string[];
  docCount: number;
  chunkCount: number;
  /** Merkle root over the sorted doc leaves — one value that changes iff any doc changes. */
  merkleRoot: string;
  /** Sorted by id — the per-doc content hashes. */
  docs: ManifestLeaf[];
}

/** The full bundled corpus (emitted by scripts/build-corpus.ts, shipped in dist). */
export interface GsdCorpus {
  docs: GsdDoc[];
  chunks: GsdChunk[];
  manifest: CorpusManifest;
}

/** What changed between two manifests — drives RET-06 incremental re-index. */
export interface ManifestDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}
