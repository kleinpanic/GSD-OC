import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "typebox/value";

/**
 * Guards the "tests pass but the HOST rejects the call" bug class: every tool's TypeBox schema
 * (additionalProperties:false) must accept a call carrying EVERY arg its execute() reads. Unit tests call
 * execute() directly and bypass schema validation, so this is the only layer that catches a schema/execute drift.
 */
const REPRESENTATIVE_CALLS: Record<string, Record<string, unknown>> = {
  gsd_orchestrate: { intent: "x", drive: true, autoGates: true, autonomous: true, wave: true },
  gsd_retrieve: { intent: "x", topK: 5 },
  gsd_settings: { profile: "full", bootstrap: true },
  gsd_command: { command: "code-review", flags: "--all", intent: "x" },
  gsd_state: { op: "commit", status: "x", decision: "d", blocker: "b", name: "n", goal: "g", phase: "1", plans: 1, done: 1, req: "R-1", version: "v1", create_repo: true, kind: "phase", total_plans: 1, completed_plans: 1, total_phases: 1, completed_phases: 1 },
  gsd_workstream: { op: "create", name: "n", intent: "x" },
  gsd_verify: { op: "gap", phase: "1" },
  gsd_session: { op: "checkpoint", reason: "r", next_step: "n", name: "t", content: "c", text: "x", type: "decision", options: [{ id: "a", label: "A" }] },
  gsd_learnings: { op: "add", kind: "lesson", text: "x", tags: ["t"], tag: "t", keep: 5 },
};

test("every tool schema accepts a call with all args its execute reads (host-validation conformance)", async () => {
  const mod = await import("../src/index.js");
  const tools: { name: string; parameters: unknown }[] = [];
  (mod.default as { register: (api: unknown) => void }).register({
    registerService() {}, registerTool(t: never) { tools.push(t); }, registerCommand() {}, registerHook() {}, registerInternalHook() {},
    session: { state: { registerSessionExtension() {} } }, pluginConfig: {},
  });
  const gsd = tools.filter((t) => t.name.startsWith("gsd_"));
  assert.equal(gsd.length, 15, "15 gsd tools");
  for (const t of gsd) {
    const call = REPRESENTATIVE_CALLS[t.name] ?? { intent: "x" };
    const ok = Value.Check(t.parameters as never, call);
    if (!ok) {
      const errs = [...Value.Errors(t.parameters as never, call)].slice(0, 3).map((e) => JSON.stringify(e));
      assert.fail(`${t.name} schema REJECTS its own representative call: ${errs.join("; ")}`);
    }
  }
});

test("op fields are literal unions — the host REJECTS an unknown op at the boundary (WR-02)", async () => {
  const { Value } = await import("typebox/value");
  const mod = await import("../src/index.js");
  const tools: { name: string; parameters: unknown }[] = [];
  (mod.default as { register: (api: unknown) => void }).register({
    registerService() {}, registerTool(t: never) { tools.push(t); }, registerCommand() {}, registerHook() {}, registerInternalHook() {},
    session: { state: { registerSessionExtension() {} } }, pluginConfig: {},
  });
  const opTools = { gsd_state: "commit", gsd_session: "checkpoint", gsd_verify: "gap", gsd_workstream: "create", gsd_learnings: "add" };
  for (const [name, goodOp] of Object.entries(opTools)) {
    const t = tools.find((x) => x.name === name)!;
    assert.ok(Value.Check(t.parameters as never, { op: goodOp }), `${name} accepts a real op`);
    assert.ok(!Value.Check(t.parameters as never, { op: "frobnicate_xyz" }), `${name} REJECTS an unknown op`);
  }
});
