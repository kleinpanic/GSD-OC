import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSubagentDispatcher, VERB_TO_SUBAGENT, executePath } from "../src/orchestrate/execute-path.js";
import { selectPath } from "../src/orchestrate/select-path.js";
import type { RunSubagentApi } from "../src/dispatch/run-subagent.js";
import entry from "../src/index.js";

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

test("executePath converts a THROWING dispatcher into a failed step (review LOW-1)", async () => {
  const path = selectPath({ intent: "build a feature", retrieved: [] });
  const dispatch = async () => {
    throw new Error("network down");
  };
  const r = await executePath(path, dispatch, { autoGates: true });
  assert.equal(r.completed, false);
  assert.equal(r.reason, "failure");
  assert.equal(r.steps.at(-1)!.output, "network down");
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

test("gsd_orchestrate drive:true reaches dispatch via the register(api) closure runtime (review CRITICAL-1)", async () => {
  // Capture the registered gsd_orchestrate tool with a mock api that carries runtime.subagent. Proves the
  // drive path resolves the runtime from the CLOSURE api (not the unreliable execute ctx arg) and executes.
  let tool: { execute: (...a: unknown[]) => Promise<{ executed?: unknown[]; completed?: boolean }> } | undefined;
  const runs: string[] = [];
  const api = {
    runtime: {
      subagent: {
        async run(p: { sessionKey: string }) { runs.push(p.sessionKey); return { runId: "r" }; },
        async waitForRun() { return { status: "ok" }; },
        async getSessionMessages() { return { messages: [{ role: "assistant", content: "ok" }] }; },
        async deleteSession() {},
      },
    },
    registerService() {},
    registerTool(t: { name: string }) { if (t.name === "gsd_orchestrate") tool = t as never; },
    registerCommand() {}, registerHook() {}, registerInteractiveHandler() {},
    session: { state: { registerSessionExtension() {} } },
  };
  entry.register(api as never);
  // Substantial intent → full backbone. No ctx 5th-arg → drive must still work via the closure api.
  const r = await tool!.execute("call", { intent: "build a new authentication feature", drive: true, autoGates: true });
  assert.ok(Array.isArray(r.executed), "drive reached executePath (executed array present)");
  assert.equal(r.completed, true, "all backbone steps dispatched to completion");
  assert.ok(runs.length >= 5, `dispatched the mapped subagents (got ${runs.length})`);
});

test("drive: a QUICK intent dispatches FAR fewer subagents (fast — no over-orchestration)", async () => {
  let tool: { execute: (...a: unknown[]) => Promise<{ completed?: boolean }> } | undefined;
  const runs: string[] = [];
  const api = {
    runtime: { subagent: {
      async run(p: { sessionKey: string }) { runs.push(p.sessionKey); return { runId: "r" }; },
      async waitForRun() { return { status: "ok" }; },
      async getSessionMessages() { return { messages: [{ role: "assistant", content: "ok" }] }; },
      async deleteSession() {},
    } },
    registerService() {}, registerTool(t: { name: string }) { if (t.name === "gsd_orchestrate") tool = t as never; },
    registerCommand() {}, registerHook() {}, registerInteractiveHandler() {},
    session: { state: { registerSessionExtension() {} } },
  };
  entry.register(api as never);
  const r = await tool!.execute("call", { intent: "rename a config key", drive: true, autoGates: true });
  assert.equal(r.completed, true);
  assert.ok(runs.length <= 2, `quick path dispatches <=2 subagents (got ${runs.length}) — completes fast`);
});

test("BL-01: embedded-auth intents activate the secure stage (OAuth/password/jwt/SSO)", () => {
  for (const i of ["add OAuth login", "add a password reset endpoint", "validate the jwt token", "wire up SSO"]) {
    const p = selectPath({ intent: i, retrieved: [] });
    assert.ok(p.some((s) => s.verb === "secure"), `"${i}" must include the secure stage`);
  }
  // a non-security feature does NOT get secure (no false-positive)
  assert.ok(!selectPath({ intent: "add a dark mode toggle", retrieved: [] }).some((s) => s.verb === "secure"));
});
