import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { autoEngageHandler, isCodingWorkspace, GSD_META_PROMPT } from "../src/hooks/auto-engage.js";

const evt = { prompt: "do work", messages: [] };

test("auto-engage fires inside ~/codeWS (ENG-02)", () => {
  const ctx = { workspaceDir: join(homedir(), "codeWS", "SomeProject") };
  const r = autoEngageHandler(evt, ctx);
  assert.ok(r, "expected an injection result");
  assert.equal(r!.prependSystemContext, GSD_META_PROMPT);
});

test("auto-engage does NOT fire outside coding workspaces (ENG-04 negative)", () => {
  assert.equal(autoEngageHandler(evt, { workspaceDir: "/tmp/random" }), undefined);
  assert.equal(autoEngageHandler(evt, {}), undefined);
});

test("isCodingWorkspace path containment", () => {
  const roots = ["/home/x/codeWS"];
  assert.equal(isCodingWorkspace("/home/x/codeWS", roots), true);
  assert.equal(isCodingWorkspace("/home/x/codeWS/a/b", roots), true);
  assert.equal(isCodingWorkspace("/home/x/codeWSX", roots), false);
  assert.equal(isCodingWorkspace(undefined, roots), false);
});
