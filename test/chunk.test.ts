import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkDoc } from "../src/retrieval/chunk.js";
import type { GsdDoc } from "../src/retrieval/types.js";

function doc(text: string): GsdDoc {
  return { id: "workflow:sample", kind: "workflow", path: "/x/sample.md", title: "Sample", text, sha256: "0" };
}

test("chunkDoc splits at headings and names each chunk's heading (RET-01)", () => {
  const d = doc("# Sample\n\nIntro para.\n\n## Section A\n\nAlpha body.\n\n## Section B\n\nBeta body.");
  const chunks = chunkDoc(d);
  const headings = chunks.map((c) => c.heading);
  assert.ok(headings.includes("Section A"), "Section A heading present");
  assert.ok(headings.includes("Section B"), "Section B heading present");
  // ordinals are contiguous from 0
  assert.deepEqual(chunks.map((c) => c.ordinal), chunks.map((_, i) => i));
  assert.deepEqual(chunks.map((c) => c.id), chunks.map((_, i) => `workflow:sample#${i}`));
});

test("chunkDoc packs paragraphs under maxChars without splitting a paragraph", () => {
  const p = "x".repeat(400);
  const d = doc(`## S\n\n${p}\n\n${p}\n\n${p}`); // 3 paras of 400
  const chunks = chunkDoc(d, 1000); // 400+2+400 = 802 fits; +400 would be 1204 > 1000 → 2 chunks
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.text.length <= 1000), "no chunk exceeds maxChars");
  // every paragraph survives intact somewhere
  assert.ok(chunks.some((c) => c.text.includes(p)));
});

test("chunkDoc is deterministic — same input yields identical chunks (manifest stability)", () => {
  const d = doc("# T\n\nA.\n\n## H\n\nB.\n\nC.");
  assert.deepEqual(chunkDoc(d), chunkDoc(d));
});

test("chunkDoc yields one title chunk for a heading-only doc", () => {
  const chunks = chunkDoc(doc("# Only A Heading"));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].ordinal, 0);
});

test("chunkDoc does not treat '# comment' inside a fenced block as a heading", () => {
  const d = doc("## Real Section\n\n```sh\n# comment line\necho hi\n```\n\nAfter fence.");
  const chunks = chunkDoc(d);
  const headings = new Set(chunks.map((c) => c.heading));
  assert.ok(headings.has("Real Section"), "real heading present");
  assert.ok(!headings.has("comment line"), "fenced '# comment' leaked as a section heading");
});

test("chunkDoc hard-splits a single paragraph larger than maxChars", () => {
  const maxChars = 1200;
  const words = Array(Math.ceil((maxChars + 500) / 5)).fill("word").join(" ");
  const d = doc(`## S\n\n${words}`);
  const chunks = chunkDoc(d, maxChars);
  assert.ok(chunks.length >= 2, `expected >=2 chunks, got ${chunks.length}`);
  assert.ok(chunks.every((c) => c.text.length <= maxChars), "a chunk exceeded maxChars");
});
