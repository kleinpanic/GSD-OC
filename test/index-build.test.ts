import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVectors } from "../src/retrieval/index-build.js";
import { buildManifest, sha256 } from "../src/retrieval/manifest.js";
import type { GsdChunk, GsdCorpus, GsdDoc } from "../src/retrieval/types.js";

function mkCorpus(docTexts: Record<string, string>): GsdCorpus {
  const docs: GsdDoc[] = Object.entries(docTexts).map(([id, text]) => ({
    id,
    kind: "workflow",
    path: id,
    title: id,
    text,
    sha256: sha256(text),
  }));
  const chunks: GsdChunk[] = docs.map((d) => ({
    id: `${d.id}#0`,
    docId: d.id,
    kind: "workflow",
    title: d.id,
    heading: d.id,
    ordinal: 0,
    text: d.text,
  }));
  return { docs, chunks, manifest: buildManifest(docs, chunks, ["root"]) };
}

test("RET-06: first build embeds every chunk", async () => {
  const corpus = mkCorpus({ "workflow:a": "alpha", "workflow:b": "beta" });
  let count = 0;
  const r = await buildVectors({
    corpus,
    embed: async (texts) => {
      count += texts.length;
      return texts.map(() => [1, 2]);
    },
  });
  assert.equal(count, 2);
  assert.equal(r.reembedded, 2);
  assert.equal(r.rows.length, 2);
});

test("RET-06: incremental build re-embeds only the changed doc's chunks; unchanged reuse cache", async () => {
  const c1 = mkCorpus({ "workflow:a": "alpha", "workflow:b": "beta" });
  const cache = new Map<string, number[]>();
  await buildVectors({ corpus: c1, embed: async (t) => t.map(() => [1, 1]), cache });

  const c2 = mkCorpus({ "workflow:a": "alpha", "workflow:b": "BETA-changed" });
  let count = 0;
  const r2 = await buildVectors({
    corpus: c2,
    embed: async (texts) => {
      count += texts.length;
      return texts.map(() => [9, 9]);
    },
    prevManifest: c1.manifest,
    cache,
  });
  assert.equal(count, 1, "only the changed doc's one chunk re-embeds");
  assert.equal(r2.reembedded, 1);
  assert.equal(r2.reused, 1);
});
