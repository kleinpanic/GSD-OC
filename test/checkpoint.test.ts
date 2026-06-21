import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCheckpoint, renderCheckpointText, parseCheckpointReply } from "../src/engine/checkpoint.js";

test("decision gate requires options + renders a numbered question (text fallback)", () => {
  assert.throws(() => buildCheckpoint("decision", "pick"), /requires options/);
  const g = buildCheckpoint("decision", "Which auth approach?", { options: [{ id: "oauth", label: "OAuth" }, { id: "jwt", label: "JWT" }] });
  assert.equal(g.surface, "text");
  assert.match(g.render, /DECISION[\s\S]*Which auth approach/);
  assert.match(g.render, /1\. OAuth[\s\S]*2\. JWT/);
});

test("human-verify + human-action default options; discord surface honored", () => {
  const v = buildCheckpoint("human-verify", "Did the tests pass?");
  assert.deepEqual(v.options.map((o) => o.id), ["pass", "fail"]);
  const a = buildCheckpoint("human-action", "Run the migration, then confirm", { discord: true });
  assert.equal(a.surface, "discord");
  assert.deepEqual(a.options.map((o) => o.id), ["done", "skip"]);
  assert.match(renderCheckpointText(a), /ACTION REQUIRED/);
});

test("parseCheckpointReply maps number / id / label / partial", () => {
  const g = buildCheckpoint("decision", "x", { options: [{ id: "oauth", label: "OAuth 2.0" }, { id: "jwt", label: "Bare JWT" }] });
  assert.equal(parseCheckpointReply(g, "1"), "oauth");
  assert.equal(parseCheckpointReply(g, "jwt"), "jwt");
  assert.equal(parseCheckpointReply(g, "OAuth 2.0"), "oauth");
  assert.equal(parseCheckpointReply(g, "bare"), "jwt");
  assert.equal(parseCheckpointReply(g, "huh?"), null);
  assert.equal(parseCheckpointReply(g, ""), null);
});

test("renderCheckpointDiscord: action-row buttons with routable custom_ids", async () => {
  const { renderCheckpointDiscord } = await import("../src/engine/checkpoint.js");
  const g = buildCheckpoint("human-verify", "Tests pass?", { discord: true });
  const d = renderCheckpointDiscord(g);
  assert.equal(d.content, "Tests pass?");
  assert.equal(d.components[0].type, 1);
  assert.deepEqual(d.components[0].components.map((b) => b.custom_id), ["gsd:human-verify:pass", "gsd:human-verify:fail"]);
  assert.equal(d.components[0].components[0].style, 3, "pass = success-green");
  // ≤5 buttons per row: 7 options → 2 rows
  const many = renderCheckpointDiscord(buildCheckpoint("decision", "pick", { options: Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `O${i}` })) }));
  assert.equal(many.components.length, 2);
  assert.equal(many.components[0].components.length, 5);
});

test("gsd_session checkpoint-reply routes a human reply (incl. a raw custom_id) back to an option id", async () => {
  const mod = await import("../src/index.js");
  const tools: { name: string; execute: (id: string, a: unknown, s?: unknown) => Promise<{ ok: boolean; chosen?: string | null }> }[] = [];
  (mod.default as { register: (api: unknown) => void }).register({
    registerService() {}, registerTool(t: never) { tools.push(t); }, registerCommand() {}, registerHook() {}, registerInternalHook() {},
    session: { state: { registerSessionExtension() {} } }, pluginConfig: {},
  });
  const session = tools.find((t) => t.name === "gsd_session")!;
  const options = [{ id: "pass", label: "Passed" }, { id: "fail", label: "Failed" }];
  // by number
  assert.equal((await session.execute("x", { op: "checkpoint-reply", text: "1", options }, undefined)).chosen, "pass");
  // by raw Discord custom_id
  assert.equal((await session.execute("x", { op: "checkpoint-reply", text: "gsd:human-verify:fail", options }, undefined)).chosen, "fail");
  // unrecognized → ok:false
  assert.equal((await session.execute("x", { op: "checkpoint-reply", text: "huh", options }, undefined)).ok, false);
});

test("sessionParams schema accepts checkpoint's options arg (host would reject otherwise)", async () => {
  const { Value } = await import("typebox/value");
  const mod = await import("../src/index.js");
  // pull the registered tool's parameters schema (the real one the host validates against)
  let sessionSchema: unknown;
  (mod.default as { register: (api: unknown) => void }).register({
    registerService() {}, registerTool(t: { name: string; parameters: unknown }) { if (t.name === "gsd_session") sessionSchema = t.parameters; },
    registerCommand() {}, registerHook() {}, registerInternalHook() {}, session: { state: { registerSessionExtension() {} } }, pluginConfig: {},
  });
  assert.ok(sessionSchema, "gsd_session registered");
  // a checkpoint call with options must pass schema validation (additionalProperties:false would reject a stray key)
  assert.ok(Value.Check(sessionSchema as never, { op: "checkpoint", text: "pick", type: "decision", options: [{ id: "a", label: "A" }] }), "checkpoint+options validates");
  assert.ok(Value.Check(sessionSchema as never, { op: "checkpoint-reply", text: "1", options: [{ id: "a", label: "A" }] }), "checkpoint-reply validates");
});

test("BL-S1: buildCheckpoint rejects an unknown type with a clear error (not a .map crash)", () => {
  assert.throws(() => buildCheckpoint("approve" as never, "x"), /unknown checkpoint type/);
  // and the gsd_session checkpoint op catches it → {ok:false}, never an uncaught throw
});
