import { test } from "node:test";
import assert from "node:assert/strict";
import { semanticSearch } from "../src/retrieval/semantic.js";
import { CosineBackend, type VectorCache } from "../src/retrieval/vectors.js";

const okResp = (e: number[]) =>
  ({ ok: true, status: 200, json: async () => ({ data: [{ embedding: e }] }) }) as unknown as Response;

test("semanticSearch embeds the query (query input_type) then returns nearest chunks", async () => {
  const cache: VectorCache = { dim: 2, chunkIds: ["near", "far"], matrix: Float32Array.from([1, 0, 0, 1]) };
  let bodyInputType: string | undefined;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    bodyInputType = JSON.parse(String(init.body)).input_type;
    return okResp([1, 0]);
  }) as unknown as typeof fetch;
  const hits = await semanticSearch("anything", new CosineBackend(cache), 2, {
    config: { baseUrl: "http://x/v1", model: "m", token: "t" },
    fetch: fakeFetch,
  });
  assert.equal(bodyInputType, "query");
  assert.equal(hits[0].chunkId, "near");
});
