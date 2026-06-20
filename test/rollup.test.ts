import { test } from "node:test";
import assert from "node:assert/strict";
import { rollup } from "../src/retrieval/rollup.js";
import { buildBm25, bm25Search } from "../src/retrieval/bm25.js";
import { loadCorpus } from "../src/retrieval/corpus.js";
import type { GsdCorpus, GsdChunk } from "../src/retrieval/types.js";

const chunk = (id: string, docId: string): GsdChunk => ({
  id,
  docId,
  kind: "workflow",
  title: docId,
  heading: docId,
  ordinal: Number(id.split("#")[1] ?? 0),
  text: "",
});

test("rollup aggregates per-doc with MAX and sorts desc", () => {
  const corpus = {
    docs: [],
    chunks: [chunk("d1#0", "d1"), chunk("d1#1", "d1"), chunk("d2#0", "d2")],
    manifest: {} as GsdCorpus["manifest"],
  } as GsdCorpus;
  const fused = [
    { chunkId: "d1#1", score: 0.9 },
    { chunkId: "d1#0", score: 0.2 },
    { chunkId: "d2#0", score: 0.5 },
  ];
  const docs = rollup(fused, corpus);
  assert.equal(docs[0].docId, "d1");
  assert.equal(docs[0].score, 0.9);
  assert.equal(docs[0].topChunkId, "d1#1");
  assert.equal(docs[1].docId, "d2");
});

test("end-to-end: lexical hits roll up to the doc that owns the top chunk", () => {
  // The "flaky build → debug doc" acceptance is semantic (see bm25.test.ts note); proving
  // it requires plan 09-02's semantic modality + retrieve.test.ts. This test proves the
  // rollup contract over the REAL corpus: BM25 chunk hits collapse to their owning docs and
  // the #1 doc owns the #1 chunk.
  const corpus = loadCorpus();
  const idx = buildBm25(corpus.chunks);
  const fused = bm25Search(idx, "the build is flaky", 20);
  const docs = rollup(fused, corpus);
  assert.ok(docs.length > 0, "rollup produced doc-level results");
  const idToDoc = new Map(corpus.chunks.map((c) => [c.id, c.docId]));
  assert.equal(docs[0].docId, idToDoc.get(fused[0].chunkId), "#1 doc owns the #1 fused chunk");
});
