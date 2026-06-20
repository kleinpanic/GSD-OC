import { test } from "node:test";
import assert from "node:assert/strict";
import { embedTexts, sparkConfig, embedAvailable, type SparkConfig } from "../src/retrieval/embed.js";

const cfg: SparkConfig = { baseUrl: "http://spark/v1", model: "m", token: "secret-xyz" };
const okResp = (embeddings: number[][]) =>
  ({ ok: true, status: 200, json: async () => ({ data: embeddings.map((e) => ({ embedding: e })) }) }) as unknown as Response;

test("embedTexts posts an OpenAI-compatible request (url, bearer, model, input_type)", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    captured = { url: String(url), init };
    return okResp([[1, 2, 3]]);
  }) as unknown as typeof fetch;
  const out = await embedTexts(["hello"], "query", { config: cfg, fetch: fakeFetch });
  assert.equal(captured!.url, "http://spark/v1/embeddings");
  assert.equal((captured!.init.headers as Record<string, string>).Authorization, "Bearer secret-xyz");
  const body = JSON.parse(String(captured!.init.body));
  assert.equal(body.model, "m");
  assert.equal(body.input_type, "query");
  assert.deepEqual(body.input, ["hello"]);
  assert.deepEqual(out, [[1, 2, 3]]);
});

test("embedTexts batches inputs in chunks of 64", async () => {
  let calls = 0;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    calls++;
    const n = JSON.parse(String(init.body)).input.length as number;
    return okResp(Array.from({ length: n }, () => [0]));
  }) as unknown as typeof fetch;
  const out = await embedTexts(
    Array.from({ length: 130 }, (_, i) => `t${i}`),
    "passage",
    { config: cfg, fetch: fakeFetch },
  );
  assert.equal(out.length, 130);
  assert.equal(calls, 3);
});

test("embedTexts([]) returns [] without calling fetch", async () => {
  let called = false;
  const fakeFetch = (async () => {
    called = true;
    return okResp([]);
  }) as unknown as typeof fetch;
  assert.deepEqual(await embedTexts([], "query", { config: cfg, fetch: fakeFetch }), []);
  assert.equal(called, false);
});

test("sparkConfig requires all env vars; trims trailing slash; embedAvailable reflects presence", () => {
  assert.equal(embedAvailable({}), false);
  assert.equal(
    embedAvailable({ SPARK_EMBEDDINGS_BASE_URL: "u", SPARK_EMBEDDINGS_MODEL: "m", SPARK_BEARER_TOKEN: "t" }),
    true,
  );
  assert.throws(() => sparkConfig({ SPARK_EMBEDDINGS_BASE_URL: "u" } as NodeJS.ProcessEnv));
  const c = sparkConfig({
    SPARK_EMBEDDINGS_BASE_URL: "http://u/v1/",
    SPARK_EMBEDDINGS_MODEL: "m",
    SPARK_BEARER_AUTH: "t",
  } as NodeJS.ProcessEnv);
  assert.equal(c.baseUrl, "http://u/v1");
  assert.equal(c.token, "t");
});
