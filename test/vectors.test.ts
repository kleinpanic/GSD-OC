import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CosineBackend,
  LanceBackend,
  normalizeInto,
  writeVectorCache,
  loadVectorCache,
  writeLanceTable,
  type VectorCache,
} from "../src/retrieval/vectors.js";

test("normalizeInto produces a unit vector", () => {
  const n = normalizeInto([3, 4]);
  assert.ok(Math.abs(Math.hypot(n[0], n[1]) - 1) < 1e-6);
  assert.ok(Math.abs(n[0] - 0.6) < 1e-6 && Math.abs(n[1] - 0.8) < 1e-6);
});

test("CosineBackend ranks the nearest row first", async () => {
  const cache: VectorCache = { dim: 2, chunkIds: ["a", "b", "c"], matrix: Float32Array.from([1, 0, 0, 1, 0.7071, 0.7071]) };
  const hits = await new CosineBackend(cache).search([1, 0], 3);
  assert.equal(hits[0].chunkId, "a");
  assert.ok(hits[0].score >= hits[1].score && hits[1].score >= hits[2].score);
});

test("writeVectorCache/loadVectorCache roundtrip stores normalized rows (tmp)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsdvec-"));
  const paths = { bin: join(dir, "v.bin"), index: join(dir, "v.json") };
  writeVectorCache([{ chunkId: "x", vector: [3, 4] }, { chunkId: "y", vector: [0, 2] }], paths);
  const c = loadVectorCache(paths)!;
  assert.equal(c.dim, 2);
  assert.deepEqual(c.chunkIds, ["x", "y"]);
  assert.ok(Math.abs(c.matrix[0] - 0.6) < 1e-6 && Math.abs(c.matrix[1] - 0.8) < 1e-6);
  assert.ok(Math.abs(c.matrix[2] - 0) < 1e-6 && Math.abs(c.matrix[3] - 1) < 1e-6);
});

test("loadVectorCache returns null when the artifact is absent", () => {
  assert.equal(loadVectorCache({ bin: "/no/x.bin", index: "/no/x.json" }), null);
});

test("LanceBackend roundtrip over the real embedded native store (no network)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsdlance-"));
  await writeLanceTable(dir, [
    { chunkId: "a", docId: "d:a", vector: [1, 0] },
    { chunkId: "b", docId: "d:b", vector: [0, 1] },
  ]);
  const hits = await (await LanceBackend.open(dir)).search([1, 0], 2);
  assert.equal(hits[0].chunkId, "a");
});
