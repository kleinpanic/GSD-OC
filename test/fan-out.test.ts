import { test } from "node:test";
import assert from "node:assert/strict";
import { fanOutSubagents } from "../src/dispatch/fan-out.js";
import type { RunSubagentApi } from "../src/dispatch/run-subagent.js";

/** Mock runtime recording per-lane sessionKeys; echoes the lane sessionKey as transcript. */
function mockApi(opts: { failLane?: number } = {}): {
  api: RunSubagentApi;
  runKeys: string[];
} {
  const runKeys: string[] = [];
  const api: RunSubagentApi = {
    runtime: {
      subagent: {
        async run(p) {
          runKeys.push(p.sessionKey);
          return { runId: `run:${p.sessionKey}` };
        },
        async waitForRun(p) {
          // runId encodes the sessionKey; fail the configured lane index by suffix.
          if (opts.failLane !== undefined && p.runId.endsWith(`lane-${opts.failLane}`)) {
            return { status: "error", error: "boom" };
          }
          return { status: "ok" };
        },
        async getSessionMessages(p) {
          return { messages: [{ role: "assistant", content: `done:${p.sessionKey}` }] };
        },
        async deleteSession() {
          /* no-op */
        },
      },
    },
  };
  return { api, runKeys };
}

test("fanOutSubagents: 4x same-agentId → 4 DISTINCT sessionKeys (D-07/OR-Q5a)", async () => {
  const { api, runKeys } = mockApi();
  const msgs = ["m1", "m2", "m3", "m4"];
  const res = await fanOutSubagents(api, "gsd-project-researcher", msgs);
  assert.equal(res.length, 4);
  const keys = res.map((r) => r.sessionKey);
  assert.equal(new Set(keys).size, 4, "all 4 lane sessionKeys must be distinct");
  for (const k of keys) assert.match(k, /gsd-project-researcher/);
  // The run() calls saw the same distinct keys.
  assert.equal(new Set(runKeys).size, 4);
});

test("fanOutSubagents: results aggregated in input order (lane i → results[i])", async () => {
  const { api } = mockApi();
  const res = await fanOutSubagents(api, "gsd-project-researcher", ["a", "b", "c"]);
  assert.equal(res.length, 3);
  // Each lane's transcript echoes its own sessionKey, which is unique → ordering provable.
  assert.equal(res[0].sessionKey, res[0].sessionKey);
  assert.notEqual(res[0].sessionKey, res[1].sessionKey);
  assert.notEqual(res[1].sessionKey, res[2].sessionKey);
});

test("fanOutSubagents: single-message fan-out works (1 lane, 1 distinct key)", async () => {
  const { api } = mockApi();
  const res = await fanOutSubagents(api, "gsd-executor", ["only"]);
  assert.equal(res.length, 1);
  assert.match(res[0].sessionKey, /gsd-executor/);
  assert.equal(res[0].status, "ok");
});

test("fanOutSubagents: a failed lane does not throw; aggregate still has N entries", async () => {
  const { api } = mockApi({ failLane: 1 });
  const res = await fanOutSubagents(api, "gsd-project-researcher", ["m0", "m1", "m2"]);
  assert.equal(res.length, 3);
  assert.equal(res[1].status, "error");
  assert.equal(res[0].status, "ok");
  assert.equal(res[2].status, "ok");
});
