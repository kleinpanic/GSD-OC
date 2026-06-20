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
