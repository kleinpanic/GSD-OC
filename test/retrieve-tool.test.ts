import { test } from "node:test";
import assert from "node:assert/strict";
import entry from "../src/index.js";

interface CapturedTool {
  name: string;
  execute: (p: { intent?: string; topK?: number }) => Promise<{ intent: string; results: { id: string }[] }>;
}

function captureApi() {
  const tools: CapturedTool[] = [];
  return {
    tools,
    registerService() {},
    registerTool(t: unknown) {
      tools.push(t as CapturedTool);
    },
    registerCommand() {},
    registerHook() {},
    registerInteractiveHandler() {},
    session: { state: { registerSessionExtension() {} } },
  };
}

test("RET-07: gsd_retrieve is registered as a 0-slot tool and returns ranked GSD skills", async () => {
  // Force the offline lexical+trigram path (no spark network) for determinism in the test runner.
  const saved = {
    u: process.env.SPARK_EMBEDDINGS_BASE_URL,
    m: process.env.SPARK_EMBEDDINGS_MODEL,
    t: process.env.SPARK_BEARER_TOKEN,
    a: process.env.SPARK_BEARER_AUTH,
  };
  delete process.env.SPARK_EMBEDDINGS_BASE_URL;
  delete process.env.SPARK_EMBEDDINGS_MODEL;
  delete process.env.SPARK_BEARER_TOKEN;
  delete process.env.SPARK_BEARER_AUTH;
  try {
    const api = captureApi();
    entry.register(api as never);
    const tool = api.tools.find((t) => t.name === "gsd_retrieve");
    assert.ok(tool, "gsd_retrieve is registered via registerTool");

    const out = await tool!.execute({ intent: "plan the next phase", topK: 5 });
    assert.ok(Array.isArray(out.results) && out.results.length > 0, "returns ranked results");
    assert.ok(out.results.every((r) => typeof r.id === "string"));

    const empty = await tool!.execute({ intent: "   " });
    assert.deepEqual(empty.results, [], "blank intent returns no results");
  } finally {
    if (saved.u) process.env.SPARK_EMBEDDINGS_BASE_URL = saved.u;
    if (saved.m) process.env.SPARK_EMBEDDINGS_MODEL = saved.m;
    if (saved.t) process.env.SPARK_BEARER_TOKEN = saved.t;
    if (saved.a) process.env.SPARK_BEARER_AUTH = saved.a;
  }
});
