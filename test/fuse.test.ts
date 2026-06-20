import { test } from "node:test";
import assert from "node:assert/strict";
import { rrf } from "../src/retrieval/fuse.js";
import type { ScoredChunk } from "../src/retrieval/bm25.js";

const list = (...ids: string[]): ScoredChunk[] => ids.map((id, i) => ({ chunkId: id, score: 100 - i }));

test("RRF rewards items ranked high in multiple lists (RET-05)", () => {
  // x is #1 in two of three lists; y is #1 in only one.
  const fused = rrf([list("x", "y"), list("x", "a"), list("y", "b")]);
  const xRank = fused.findIndex((h) => h.chunkId === "x");
  const yRank = fused.findIndex((h) => h.chunkId === "y");
  assert.ok(xRank < yRank, "x (top in two lists) should outrank y (top in one)");
});

test("RRF tolerates empty lists (no crash, contribute nothing)", () => {
  const fused = rrf([[], list("a", "b"), []]);
  assert.equal(fused[0].chunkId, "a");
  assert.equal(fused.length, 2);
});

test("RRF uses k=60 default and 1-based rank", () => {
  const fused = rrf([list("a")]);
  assert.ok(Math.abs(fused[0].score - 1 / 61) < 1e-12);
});

test("RRF honors per-modality weights", () => {
  // a is #1 only in the down-weighted list; b is #2 in the up-weighted list.
  const fused = rrf([list("a"), list("c", "b")], 60, [0.1, 5]);
  const aRank = fused.findIndex((h) => h.chunkId === "a");
  const bRank = fused.findIndex((h) => h.chunkId === "b");
  assert.ok(bRank < aRank, "heavily-weighted list should dominate");
});

test("RRF ranking is deterministic with chunkId tie-break", () => {
  const fused = rrf([list("z"), list("a")]);
  assert.deepEqual(fused.map((h) => h.chunkId), ["a", "z"]);
});
