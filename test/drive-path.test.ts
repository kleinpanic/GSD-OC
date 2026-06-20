import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSubagentDispatcher, VERB_TO_SUBAGENT, executePath } from "../src/orchestrate/execute-path.js";
import { selectPath } from "../src/orchestrate/select-path.js";
import type { RunSubagentApi } from "../src/dispatch/run-subagent.js";

/** Mock subagent runtime: records run() calls, returns ok with canned text. */
function mockApi(status: "ok" | "error" = "ok") {
  const runs: string[] = [];
  const api = {
    runtime: {
      subagent: {
        async run(p: { sessionKey: string; message: string }) {
          runs.push(p.sessionKey);
          return { runId: "r" + runs.length };
        },
        async waitForRun() {
          return { status };
        },
        async getSessionMessages() {
          return { messages: [{ role: "assistant", content: "done" }] };
        },
        async deleteSession() {},
      },
    },
  } as unknown as RunSubagentApi;
  return { api, runs };
}

test("makeSubagentDispatcher dispatches mapped verbs, no-ops unmapped (gate/skill) steps", async () => {
  const { api, runs } = mockApi("ok");
  const dispatch = makeSubagentDispatcher(api, "the build is flaky");
  const planOk = await dispatch({ verb: "plan", skill: "gsd-plan-phase", reason: "core", gate: true });
  assert.equal(planOk.ok, true);
  assert.equal(runs.length, 1, "plan → one subagent run");
  const ship = await dispatch({ verb: "ship", skill: "gsd-ship", reason: "core", gate: false });
  assert.equal(ship.ok, true);
  assert.equal(runs.length, 1, "ship is unmapped → no subagent run (no-op success)");
});

test("driving a path with autoGates dispatches every mapped subagent in order to completion", async () => {
  const { api, runs } = mockApi("ok");
  const path = selectPath({ intent: "the build is flaky", retrieved: [{ docId: "agent:gsd-debugger" }] });
  const dispatch = makeSubagentDispatcher(api, "the build is flaky");
  const r = await executePath(path, dispatch, { autoGates: true });
  assert.equal(r.completed, true);
  // mapped verbs in this path: map-codebase, plan, debug, execute, code-review, verify
  const mappedCount = path.filter((s) => VERB_TO_SUBAGENT[s.verb]).length;
  assert.equal(runs.length, mappedCount);
  assert.ok(mappedCount >= 5);
});

test("a failed subagent run halts the driven path (enforced failure)", async () => {
  const { api } = mockApi("error");
  const path = selectPath({ intent: "build a feature", retrieved: [] });
  const dispatch = makeSubagentDispatcher(api, "build a feature");
  const r = await executePath(path, dispatch, { autoGates: true });
  assert.equal(r.completed, false);
  assert.equal(r.reason, "failure");
  // first mapped step is map-codebase → it fails → halt there
  assert.equal(r.haltedAt, "map-codebase");
});
