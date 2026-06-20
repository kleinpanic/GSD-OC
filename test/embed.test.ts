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

test("embedTexts batches inputs in chunks of 32", async () => {
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
  assert.equal(calls, 5); // 130 inputs / 32 per batch = 5 requests
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

test("sparkConfig adapts to the GATEWAY env contract (SPARK_HOST + SPARK_BEARER_TOKEN/SPARK_API_KEY)", () => {
  // The OpenClaw gateway exports SPARK_HOST + SPARK_BEARER_TOKEN, NOT SPARK_EMBEDDINGS_BASE_URL/MODEL.
  // embedAvailable must be true and the base URL derived from the host (this was the live semantic:false bug).
  const gw = { SPARK_HOST: "10.99.1.1", SPARK_BEARER_TOKEN: "tok", SPARK_API_KEY: "tok" } as NodeJS.ProcessEnv;
  assert.equal(embedAvailable(gw), true);
  const c = sparkConfig(gw);
  assert.equal(c.baseUrl, "http://10.99.1.1:18091/v1");
  assert.equal(c.model, "nvidia/llama-nemotron-embed-vl-1b-v2"); // default = corpus-vector model
  assert.equal(c.token, "tok");
  // SPARK_API_KEY alone (no bearer) also works
  assert.equal(embedAvailable({ SPARK_HOST: "h", SPARK_API_KEY: "k" } as NodeJS.ProcessEnv), true);
});

test("sparkConfig: SPARK_HOST with a scheme gets a /v1 path (review HIGH-2)", () => {
  const c1 = sparkConfig({ SPARK_HOST: "https://spark.internal", SPARK_API_KEY: "k" } as NodeJS.ProcessEnv);
  assert.equal(c1.baseUrl, "https://spark.internal/v1", "scheme host without version → append /v1");
  const c2 = sparkConfig({ SPARK_HOST: "https://spark.internal/v1/", SPARK_API_KEY: "k" } as NodeJS.ProcessEnv);
  assert.equal(c2.baseUrl, "https://spark.internal/v1", "scheme host already versioned → unchanged (trailing slash trimmed)");
});
