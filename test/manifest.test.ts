import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, merkleRoot, buildManifest, diffManifest } from "../src/retrieval/manifest.js";
import type { GsdDoc } from "../src/retrieval/types.js";

const mkDoc = (id: string, text: string): GsdDoc => ({
  id,
  kind: "workflow",
  path: `/x/${id}.md`,
  title: id,
  text,
  sha256: sha256(text),
});

test("sha256 is the standard hex digest (RET-06 leaf)", () => {
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256("a").length, 64);
});

test("merkleRoot is order-independent and defined for empty input", () => {
  assert.equal(merkleRoot([]), sha256(""));
  assert.equal(merkleRoot(["a", "b", "c"]), merkleRoot(["c", "a", "b"]));
});

test("merkleRoot changes iff a leaf changes", () => {
  const base = merkleRoot(["a", "b", "c"]);
  assert.equal(base, merkleRoot(["a", "b", "c"]));
  assert.notEqual(base, merkleRoot(["a", "b", "c2"]));
});

test("buildManifest sorts leaves and stamps a stable root", () => {
  const docs = [mkDoc("workflow:b", "two"), mkDoc("workflow:a", "one")];
  const m = buildManifest(docs, [], ["/root"]);
  assert.equal(m.docCount, 2);
  assert.deepEqual(m.docs.map((l) => l.id), ["workflow:a", "workflow:b"]); // sorted
  assert.equal(m.merkleRoot, merkleRoot([sha256("one"), sha256("two")]));
});

test("diffManifest classifies added / removed / changed / unchanged (RET-06 incremental)", () => {
  const prev = buildManifest([mkDoc("a", "1"), mkDoc("b", "2"), mkDoc("c", "3")], [], ["/r"]);
  const next = buildManifest([mkDoc("a", "1"), mkDoc("b", "CHANGED"), mkDoc("d", "4")], [], ["/r"]);
  const diff = diffManifest(prev, next);
  assert.deepEqual(diff.unchanged, ["a"]);
  assert.deepEqual(diff.changed, ["b"]);
  assert.deepEqual(diff.added, ["d"]);
  assert.deepEqual(diff.removed, ["c"]);
});
