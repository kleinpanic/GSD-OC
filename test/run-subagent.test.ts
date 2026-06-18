import { test } from "node:test";
import assert from "node:assert/strict";
import { runSubagent, extractAssistantText, type RunSubagentApi } from "../src/dispatch/run-subagent.js";

/** A mock subagent runtime that records calls and returns a canned transcript. */
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
          return {
            messages: [
              { role: "user", content: "hi" },
              { role: "assistant", content: "ROADMAP CREATED: 7 phases" },
            ],
          };
        },
        async deleteSession(p) {
          calls.del.push(p);
        },
      },
    },
  };
  return { api, calls };
}

test("runSubagent dispatches by agentId via sessionKey and extracts assistant text (ORCH-01/AGT-02)", async () => {
  const { api, calls } = mockApi();
  const res = await runSubagent(api, "gsd-roadmapper", "create the roadmap");
  assert.equal(res.status, "ok");
  assert.equal(res.text, "ROADMAP CREATED: 7 phases");
  // sessionKey must encode the agentId (CRITICAL #4: no agentId param on run()).
  const runParams = calls.run[0] as { sessionKey: string; message: string };
  assert.ok(runParams.sessionKey.includes("gsd-roadmapper"), "sessionKey should encode agentId");
  assert.equal(runParams.message, "create the roadmap");
  assert.equal(calls.del.length, 1, "session cleaned up by default");
});

test("runSubagent surfaces a timeout without throwing", async () => {
  const { api } = mockApi();
  api.runtime.subagent.waitForRun = async () => ({ status: "timeout" });
  const res = await runSubagent(api, "gsd-planner", "plan it");
  assert.equal(res.status, "timeout");
  assert.equal(res.text, "");
});

// ── L-03: distinguish parser drift ("no text parsed") from a genuine empty reply ──

test("L-03: extractAssistantText flags a string/array reply as parsed", () => {
  assert.deepEqual(extractAssistantText([{ role: "assistant", content: "hi" }]), {
    text: "hi",
    parsed: true,
  });
  // A recognized array-of-parts assistant message that is genuinely empty:
  // parsed:true, text:"" — the agent said nothing, NOT parser drift.
  assert.deepEqual(extractAssistantText([{ role: "assistant", content: [] }]), {
    text: "",
    parsed: true,
  });
});

test("L-03: an unrecognized assistant content shape is parsed:false (parser drift)", () => {
  // Tool-result-only / {type,value} shape the extractor does not understand.
  assert.deepEqual(
    extractAssistantText([{ role: "assistant", content: { type: "text", value: "x" } }]),
    { text: "", parsed: false },
  );
  // No assistant message at all → also parser-cannot-tell.
  assert.deepEqual(extractAssistantText([{ role: "user", content: "hi" }]), {
    text: "",
    parsed: false,
  });
});

test("L-03: runSubagent surfaces the parsed flag so callers tell empty from undecodable", async () => {
  const { api } = mockApi();
  api.runtime.subagent.getSessionMessages = async () => ({
    messages: [{ role: "assistant", content: { type: "text", value: "drift" } }],
  });
  const res = await runSubagent(api, "gsd-planner", "go");
  assert.equal(res.status, "ok");
  assert.equal(res.text, "");
  assert.equal(res.parsed, false, "undecodable assistant shape must report parsed:false");
});
