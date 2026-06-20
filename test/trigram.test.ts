import { test } from "node:test";
import assert from "node:assert/strict";
import { trigrams, buildTrigram, trigramSearch } from "../src/retrieval/trigram.js";
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

test("trigrams pads with spaces (pg_trgm convention)", () => {
  const g = trigrams("ab");
  assert.ok(g.has(" ab"));
  assert.ok(g.has("ab "));
});

test("trigramSearch tolerates a typo: 'flakey' surfaces 'flaky' (RET-04)", () => {
  const chunks = [
    chunk("a#0", "the build is flaky and intermittent"),
    chunk("b#0", "completely unrelated content about onboarding"),
  ];
  const idx = buildTrigram(chunks);
  const hits = trigramSearch(idx, "flakey", 5);
  assert.equal(hits[0].chunkId, "a#0");
});

test("trigramSearch ranking is deterministic with chunkId tie-break", () => {
  const chunks = [chunk("z#0", "alpha"), chunk("a#0", "alpha")];
  const idx = buildTrigram(chunks);
  const hits = trigramSearch(idx, "alpha", 5);
  assert.deepEqual(hits.map((h) => h.chunkId), ["a#0", "z#0"]);
});

test("trigrams of a single char is the padded gram; empty string yields none", () => {
  assert.deepEqual([...trigrams("x")], [" x "]);
  assert.equal(trigrams("").size, 0);
});

test("empty query searches to []", () => {
  const idx = buildTrigram([chunk("a#0", "alpha")]);
  assert.deepEqual(trigramSearch(idx, "", 5), []);
});

test("self-similarity is Dice 1.0", () => {
  const idx = buildTrigram([chunk("a#0", "flaky")]);
  const hits = trigramSearch(idx, "flaky", 5);
  assert.equal(hits[0].chunkId, "a#0");
  assert.ok(Math.abs(hits[0].score - 1.0) < 1e-12);
});
