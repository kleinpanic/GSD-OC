import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestFlags } from "../src/orchestrate/flags.js";

test("flags-as-intent: maps intent to GSD flags", () => {
  assert.deepEqual(suggestFlags("review everything across the codebase"), ["--all"]);
  assert.ok(suggestFlags("do a deep forensic audit").includes("--forensic"));
  assert.ok(suggestFlags("research it first then plan").includes("--research"));
  assert.ok(suggestFlags("run autonomously, don't stop").includes("--auto"));
  assert.ok(suggestFlags("get another AI to peer review the plan").includes("--reviews"));
});

test("flags-as-intent: extracts phase ranges (--from/--to)", () => {
  assert.deepEqual(suggestFlags("execute from phase 2 to 5"), ["--from 2", "--to 5"]);
  assert.deepEqual(suggestFlags("run phases 3-7"), ["--from 3", "--to 7"]);
  assert.deepEqual(suggestFlags("starting from phase 4"), ["--from 4"]);
});

test("flags-as-intent: no flags for a plain intent", () => {
  assert.deepEqual(suggestFlags("add a login button"), []);
});

test("flags-as-intent: combines multiple", () => {
  const f = suggestFlags("autonomously review all phases forensically");
  assert.ok(f.includes("--all") && f.includes("--forensic") && f.includes("--auto"));
});
