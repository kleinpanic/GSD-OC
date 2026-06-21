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

test("flags-as-intent: the full upstream flag set is covered", () => {
  assert.ok(suggestFlags("use TDD", "plan-phase").includes("--tdd"));
  assert.ok(suggestFlags("just an MVP", "plan-phase").includes("--mvp"));
  assert.ok(suggestFlags("surface the assumptions", "discuss-phase").includes("--assumptions"));
  assert.ok(suggestFlags("check coverage gaps", "plan-phase").includes("--gaps"));
  assert.ok(suggestFlags("from the PRD spec file", "plan-phase").includes("--prd"));
  assert.ok(suggestFlags("execute wave 2", "execute-phase").includes("--wave 2"));
  assert.ok(suggestFlags("walk me through it step by step", "execute-phase").includes("--interactive"));
  assert.ok(suggestFlags("ship as a draft", "ship").includes("--draft"));
  assert.ok(suggestFlags("repair the state", "next").includes("--repair"));
  assert.ok(suggestFlags("backfill the missing summaries").includes("--backfill"));
  assert.ok(suggestFlags("bounce the plan", "plan-phase").includes("--bounce"));
  assert.ok(suggestFlags("power mode", "discuss-phase").includes("--power"));
  assert.ok(suggestFlags("in batch", "discuss-phase").includes("--batch"));
});

test("BLOCKER #2: --wave / --from / --to honor command scoping (no execute-only flag on ship)", () => {
  assert.deepEqual(suggestFlags("execute wave 2 then ship", "ship"), [], "ship gets no --wave");
  assert.ok(suggestFlags("execute wave 2", "execute-phase").includes("--wave 2"), "execute gets --wave");
  assert.deepEqual(suggestFlags("from phase 2 to 5", "discuss-phase").filter((f) => f.startsWith("--from") || f.startsWith("--to")), [], "discuss gets no range flags");
  assert.ok(suggestFlags("from phase 2 to 5", "execute-phase").includes("--from 2"), "execute gets range flags");
  assert.ok(suggestFlags("execute wave 2").includes("--wave 2"), "no command → wave applies (generic routing)");
});
