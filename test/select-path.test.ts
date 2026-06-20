import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPath } from "../src/orchestrate/select-path.js";

const has = (path: { verb: string }[], verb: string) => path.some((s) => s.verb === verb);
const idx = (path: { verb: string }[], verb: string) => path.findIndex((s) => s.verb === verb);

test("PATH-01: backbone always present, in canonical lifecycle order", () => {
  const p = selectPath({ intent: "build a feature", retrieved: [] });
  assert.deepEqual(
    p.map((s) => s.verb),
    ["discuss", "map-codebase", "plan", "execute", "code-review", "verify", "ship"],
  );
  // discuss / plan / verify are decision gates (ENF-01)
  assert.ok(p.find((s) => s.verb === "discuss")!.gate);
  assert.ok(p.find((s) => s.verb === "plan")!.gate);
});

test("PATH-01: frontend intent → ui step inserted before plan (retrieval-driven)", () => {
  const p = selectPath({ intent: "design the UI", retrieved: [{ docId: "agent:gsd-ui-checker" }, { docId: "workflow:ui-phase" }] });
  assert.ok(has(p, "ui"), "ui step present");
  assert.ok(idx(p, "ui") < idx(p, "plan"), "ui contract comes before planning");
});

test("PATH-01: AI intent → ai-integration (eval) step inserted", () => {
  const p = selectPath({ intent: "build an AI agent", retrieved: [{ docId: "agent:gsd-eval-planner" }, { docId: "workflow:ai-integration-phase" }] });
  assert.ok(has(p, "ai-integration"));
  assert.ok(idx(p, "ai-integration") < idx(p, "plan"));
});

test("PATH-01: bugfix intent → debug step inserted", () => {
  const p = selectPath({ intent: "the build is flaky", retrieved: [{ docId: "agent:gsd-debugger" }, { docId: "workflow:debug" }] });
  assert.ok(has(p, "debug"));
});

test("PATH-01: security intent → secure step inserted", () => {
  const p = selectPath({ intent: "audit the security", retrieved: [{ docId: "agent:gsd-security-auditor" }, { docId: "workflow:secure-phase" }] });
  assert.ok(has(p, "secure"));
});

test("PATH-01: no long-tail retrieval → backbone only, no spurious long-tail steps", () => {
  const p = selectPath({ intent: "add a config option", retrieved: [{ docId: "workflow:plan-phase" }, { docId: "agent:gsd-planner" }] });
  assert.ok(!has(p, "ui") && !has(p, "debug") && !has(p, "ai-integration") && !has(p, "secure"));
  assert.equal(p.length, 7);
});
