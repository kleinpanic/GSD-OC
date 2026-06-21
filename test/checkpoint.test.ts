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
