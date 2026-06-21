import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVectorCache, CosineBackend } from "../src/retrieval/vectors.js";

test("MED-01: a truncated/unaligned .bin returns null, not a crash", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-vec-"));
  try {
    writeFileSync(join(d, "vectors.index.json"), JSON.stringify({ dim: 4, chunkIds: ["a"] }));
    writeFileSync(join(d, "vectors.generated.bin"), Buffer.from([1, 2, 3])); // 3 bytes — not a multiple of 4
    assert.equal(loadVectorCache({ bin: join(d, "vectors.generated.bin"), index: join(d, "vectors.index.json") }), null);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("MED-02: a zero query vector yields no semantic hits (no garbage ranking)", async () => {
  const cache = { dim: 2, chunkIds: ["a", "b"], matrix: new Float32Array([1, 0, 0, 1]) };
  const out = await new CosineBackend(cache).search([0, 0], 5);
  assert.deepEqual(out, []);
});
