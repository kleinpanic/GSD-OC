import { test } from "node:test";
import assert from "node:assert/strict";
import { runSubagent, type RunSubagentApi } from "../src/dispatch/run-subagent.js";
import { resolveAgent } from "../src/agents/index.js";

/** Mock runtime that records the run() params it was called with. */
function mockApi(): { api: RunSubagentApi; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { run: [], wait: [], get: [], del: [] };
  const api: RunSubagentApi = {
    runtime: {
      subagent: {
        async run(p) {
          calls.run.push(p);
          return { runId: "run-1" };
        },
        async waitForRun(p) {
          calls.wait.push(p);
          return { status: "ok" };
        },
        async getSessionMessages(p) {
          calls.get.push(p);
          return { messages: [{ role: "assistant", content: "done" }] };
        },
        async deleteSession(p) {
          calls.del.push(p);
        },
      },
    },
  };
  return { api, calls };
}

test("dispatch injects extraSystemPrompt === def.prompt for a ported agent (D-04/AGT-02)", async () => {
  const { api, calls } = mockApi();
  const res = await runSubagent(api, "gsd-executor", "execute the plan");
  assert.equal(res.status, "ok");
  const p = calls.run[0] as { sessionKey: string; extraSystemPrompt?: string; lane?: string };
  const def = resolveAgent("gsd-executor");
  assert.equal(p.extraSystemPrompt, def.prompt, "persona must be injected from the registry");
  assert.equal(p.lane, def.thinking, "lane carries the effort tier");
  assert.ok(p.sessionKey.includes("gsd-executor"), "sessionKey still encodes agentId");
});

test("dispatch does NOT pass any tools arg (03-01 spike: NOT-ENFORCED-by-subagent.run)", async () => {
  const { api, calls } = mockApi();
  await runSubagent(api, "gsd-security-auditor", "audit");
  const p = calls.run[0] as Record<string, unknown>;
  assert.equal("tools" in p, false, "subagent.run must not receive a tools arg");
  assert.equal("allow" in p, false);
  assert.equal("deny" in p, false);
});

test("unknown agentId degrades to Phase-1 behavior (no throw, no persona)", async () => {
  const { api, calls } = mockApi();
  const res = await runSubagent(api, "gsd-not-a-real-agent", "do it");
  assert.equal(res.status, "ok", "unknown id must not throw (backward-compat)");
  const p = calls.run[0] as { extraSystemPrompt?: string };
  assert.equal(p.extraSystemPrompt, undefined, "unknown id carries no persona");
});

test("Phase-1 contract intact: sessionKey encodes agentId, text extracted, cleanup runs", async () => {
  const { api, calls } = mockApi();
  const res = await runSubagent(api, "gsd-planner", "plan it");
  assert.equal(res.text, "done");
  const p = calls.run[0] as { sessionKey: string; message: string };
  assert.ok(p.sessionKey.includes("gsd-planner"));
  assert.equal(p.message, "plan it");
  assert.equal(calls.del.length, 1, "session cleaned up by default");
});
