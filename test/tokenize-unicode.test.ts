import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/retrieval/tokenize.js";

test("ASCII tokenization is unchanged (hyphen id split preserved)", () => {
  assert.deepEqual(tokenize("fix the gsd-debug build"), ["fix", "the", "gsd-debug", "gsd", "debug", "build"]);
});

test("Unicode terms survive intact (non-English intents keep their words in the lexical arm)", () => {
  // an accented Spanish word is one token, not mangled into "autenticaci" + "n"
  assert.ok(tokenize("corrige el error de autenticación").includes("autenticación"));
  // CJK terms are tokens, not dropped as delimiters
  assert.ok(tokenize("修复 认证 bug").includes("修复") && tokenize("修复 认证 bug").includes("认证"));
  // Cyrillic
  assert.ok(tokenize("исправить ошибку").includes("исправить"));
});

test("pure-punctuation / whitespace still yields no tokens", () => {
  assert.deepEqual(tokenize("   "), []);
  assert.deepEqual(tokenize("--- ::: ###"), []);
});
