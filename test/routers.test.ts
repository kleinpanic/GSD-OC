import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTERS, routeIntent, buildRouterTools, routerMetadataTools } from "../src/routers/routers.js";

test("exactly 6 namespace routers (RTE-01), zero Discord slash slots by design", () => {
  assert.equal(ROUTERS.length, 6);
  const names = ROUTERS.map((r) => r.name).sort();
  assert.deepEqual(names, [
    "gsd_context",
    "gsd_ideate",
    "gsd_manage",
    "gsd_project",
    "gsd_quality",
    "gsd_workflow",
  ]);
});

test("router matches intent to a concrete verb within its namespace", () => {
  const wf = ROUTERS.find((r) => r.name === "gsd_workflow")!;
  assert.equal(routeIntent(wf, "let's plan the next phase").matched, "plan");
  assert.equal(routeIntent(wf, "execute it").matched, "execute");
  assert.equal(routeIntent(wf, "").matched, null);
});

test("WR-02 regression: routeIntent matches whole words, not raw substrings", () => {
  const wf = ROUTERS.find((r) => r.name === "gsd_workflow")!;
  const mng = ROUTERS.find((r) => r.name === "gsd_manage")!;
  // "planet" must NOT match "plan"; "threadbare" must NOT match "thread".
  assert.equal(routeIntent(wf, "send a planet photo").matched, null);
  assert.equal(routeIntent(mng, "this is threadbare").matched, null);
  // A real word-boundary intent still matches.
  assert.equal(routeIntent(wf, "plan the next phase").matched, "plan");
  assert.equal(routeIntent(mng, "start a thread").matched, "thread");
});

test("buildRouterTools produces 6 callable tool descriptors with params", () => {
  const tools = buildRouterTools();
  assert.equal(tools.length, 6);
  for (const t of tools) {
    assert.ok(typeof t.execute === "function");
    assert.ok(t.parameters, "tool has TypeBox parameters");
  }
});

test("router metadata tool names match the registered tool names (validate contract)", () => {
  const meta = routerMetadataTools().map((m) => m.name).sort();
  const live = buildRouterTools().map((t) => t.name).sort();
  assert.deepEqual(meta, live);
});

test("routeIntent returned shape includes candidates + engine note", async () => {
  const hit = routeIntent(ROUTERS[0], "map the codebase");
  assert.ok(Array.isArray(hit.candidates));
  assert.ok(hit.note.includes("Phase-2"));
});
