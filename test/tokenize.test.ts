import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/retrieval/tokenize.js";

test("tokenize drops sub-2-char tokens (stop-word-ish 'a'/'I')", () => {
  assert.deepEqual(tokenize("a I of"), ["of"]);
});

test("tokenize yields nothing from pure punctuation", () => {
  assert.deepEqual(tokenize("!!! ??? ..."), []);
});

test("tokenize emits joined hyphen id plus split parts", () => {
  const t = tokenize("gsd-debug");
  for (const want of ["gsd-debug", "gsd", "debug"]) {
    assert.ok(t.includes(want), `expected "${want}" in ${JSON.stringify(t)}`);
  }
});

test("tokenize discards emoji / non-[a-z0-9-] runs", () => {
  assert.deepEqual(tokenize("emoji 🚀 test"), ["emoji", "test"]);
});
