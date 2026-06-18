import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ROUTERS, routeIntent } from "../src/routers/routers.js";
import { wireRouterExecute, buildWiredRouterTools } from "../src/routers/route-wire.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => join(here, "..", "..", "test", "fixtures", name);

const wf = ROUTERS.find((r) => r.name === "gsd_workflow")!;

test("wired execute returns route()'s authoritative {next_verb,reason,args} (RTE-01, D-01)", async () => {
  // route-incomplete: Route 0 → execute-phase, phase 1, resume-incomplete.
  const hit = await wireRouterExecute(wf, fx("route-incomplete"))({ intent: "do something" });
  assert.equal(hit.namespace, "workflow");
  assert.equal(hit.next_verb, "execute-phase");
  assert.equal(hit.reason, "resume-incomplete");
  assert.deepEqual(hit.args, { phase: "1" });
});

test("wired execute surfaces a halt result without throwing (hard-stop gate)", async () => {
  // route-gates: .continue-here.md → halt / unresolved-checkpoint.
  const hit = await wireRouterExecute(wf, fx("route-gates"))();
  assert.equal(hit.next_verb, "halt");
  assert.equal(hit.reason, "unresolved-checkpoint");
  assert.deepEqual(hit.args, {});
});

test("wired execute maps a no-phase route() to bounded args", async () => {
  // route-complete: Route 5 → verify-work, phase 1.
  const hit = await wireRouterExecute(wf, fx("route-complete"))();
  assert.equal(hit.next_verb, "verify-work");
  assert.equal(hit.reason, "all-summaries");
  assert.deepEqual(hit.args, { phase: "1" });
});

test("next_verb is route().action (authoritative), NOT routeIntent().matched (anti-static-table)", async () => {
  // routeIntent over a freeform intent matches a STATIC verb table entry; the wired path
  // ignores intent and returns the state-aware route() verb. They must differ here.
  const intent = "I want to map the codebase right now";
  const staticHit = routeIntent(wf, intent); // matched ∈ workflow verbs or null
  const wiredHit = await wireRouterExecute(wf, fx("route-incomplete"))({ intent });
  assert.notEqual(wiredHit.next_verb, staticHit.matched);
  assert.equal(wiredHit.next_verb, "execute-phase");
});

test("routeIntent static fallback remains exported and unchanged (backward-compat)", () => {
  assert.equal(routeIntent(wf, "let's plan the next phase").matched, "plan");
  assert.equal(routeIntent(wf, "").matched, null);
});

test("buildWiredRouterTools produces 6 callable descriptors with TypeBox params", async () => {
  const tools = buildWiredRouterTools(fx("route-incomplete"));
  assert.equal(tools.length, 6);
  for (const t of tools) {
    assert.ok(typeof t.execute === "function");
    assert.ok(t.parameters, "tool has TypeBox parameters");
  }
  const hit = await tools[0].execute({});
  assert.equal(hit.next_verb, "execute-phase");
});
