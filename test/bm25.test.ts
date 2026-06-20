import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBm25, bm25Search } from "../src/retrieval/bm25.js";
import { tokenize } from "../src/retrieval/tokenize.js";
import { loadCorpus } from "../src/retrieval/corpus.js";
import type { GsdChunk } from "../src/retrieval/types.js";

const chunk = (id: string, text: string): GsdChunk => ({
  id,
  docId: id.split("#")[0],
  kind: "workflow",
  title: id,
  heading: id,
  ordinal: 0,
  text,
});

test("loadCorpus returns the full bundled corpus (RET-01)", () => {
  const corpus = loadCorpus();
  // Chunk count reflects the PORT-01-adapted corpus (Claude-runtime refs rewritten → more compact text).
  assert.equal(corpus.chunks.length, 3554);
  assert.equal(corpus.docs.length, 233);
  assert.deepEqual(Object.keys(corpus), ["docs", "chunks", "manifest"]);
});

test("tokenize emits joined + split parts for hyphen ids (RET-03/L7)", () => {
  const t = tokenize("gsd-debug flaky");
  for (const want of ["gsd-debug", "gsd", "debug", "flaky"]) {
    assert.ok(t.includes(want), `expected token "${want}" in ${JSON.stringify(t)}`);
  }
});

test("BM25 ranks a uniquely-matching chunk first (RET-03)", () => {
  const chunks = [
    chunk("a#0", "alpha beta gamma"),
    chunk("b#0", "delta epsilon zeta"),
    chunk("c#0", "alpha alpha xenon"),
  ];
  const idx = buildBm25(chunks);
  const hits = bm25Search(idx, "xenon", 5);
  assert.equal(hits[0].chunkId, "c#0");
});

test("BM25 ranking is deterministic with chunkId tie-break", () => {
  const chunks = [chunk("z#0", "same word"), chunk("a#0", "same word")];
  const idx = buildBm25(chunks);
  const hits = bm25Search(idx, "same", 5);
  assert.deepEqual(hits.map((h) => h.chunkId), ["a#0", "z#0"]);
});

test("'the build is flaky' ranks the flaky-bearing chunks (lexical reach, L7)", () => {
  // Acceptance landmine note: the query→debug-doc mapping is SEMANTIC, not lexical.
  // "flaky" appears in zero debug-doc chunks and "build" is a near-stopword (222 chunks),
  // so neither BM25 nor BM25+trigram can surface workflow:debug / agent:gsd-debugger for
  // this query (verified: best lexical+trigram rollup rank for a debug doc is ~51). The
  // debug-doc acceptance is therefore proven by the SEMANTIC modality and the end-to-end
  // retrieve.test.ts in plan 09-02 (research §"Trigram+semantic catch flaky/build → debug").
  // Here we assert what BM25 legitimately delivers: the rare term "flaky" pulls its
  // bearing chunks into the ranking ahead of the long tail.
  const corpus = loadCorpus();
  const idx = buildBm25(corpus.chunks);
  const hits = bm25Search(idx, "the build is flaky", 20);
  const idToText = new Map(corpus.chunks.map((c) => [c.id, c.text]));
  const found = hits.some((h) => /flaky/i.test(idToText.get(h.chunkId) ?? ""));
  assert.ok(found, "expected at least one 'flaky'-bearing chunk in BM25 top-20");
});

test("empty index searches to []", () => {
  assert.deepEqual(bm25Search(buildBm25([]), "anything", 5), []);
});

test("negative topK returns [] (not all-but-last)", () => {
  const idx = buildBm25([chunk("a#0", "alpha"), chunk("b#0", "alpha")]);
  assert.deepEqual(bm25Search(idx, "alpha", -1), []);
});

test("an empty-text chunk never matches", () => {
  const idx = buildBm25([chunk("e#0", ""), chunk("a#0", "alpha")]);
  const hits = bm25Search(idx, "alpha", 5);
  assert.ok(!hits.some((h) => h.chunkId === "e#0"), "empty chunk matched");
});
