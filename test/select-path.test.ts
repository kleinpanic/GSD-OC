import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPath } from "../src/orchestrate/select-path.js";

const has = (path: { verb: string }[], verb: string) => path.some((s) => s.verb === verb);
const idx = (path: { verb: string }[], verb: string) => path.findIndex((s) => s.verb === verb);

test("PATH-01: backbone always present, in canonical lifecycle order", () => {
  const p = selectPath({ intent: "build a feature", retrieved: [] });
  assert.deepEqual(
    p.map((s) => s.verb),
    ["discuss", "map-codebase", "research", "plan", "execute", "code-review", "verify", "ship"],
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

test("PATH-01: substantial work, no long-tail → full backbone only", () => {
  const p = selectPath({ intent: "build a new feature", retrieved: [{ docId: "workflow:plan-phase" }, { docId: "agent:gsd-planner" }] });
  assert.ok(!has(p, "ui") && !has(p, "debug") && !has(p, "ai-integration") && !has(p, "secure"));
  assert.equal(p.length, 8); // backbone: discuss, map-codebase, research, plan, execute, code-review, verify, ship
  assert.ok(has(p, "research"), "research is core (research-first GSD, ENF-02)");
});

test("PATH-complexity: a QUICK intent gets the minimal path, not the full lifecycle (gsd-quick parity)", () => {
  const p = selectPath({ intent: "rename a config key", retrieved: [] });
  assert.deepEqual(p.map((s) => s.verb), ["execute", "verify"], "quick = execute + light verify only");
  assert.ok(!has(p, "discuss") && !has(p, "plan") && !has(p, "map-codebase") && !has(p, "ship"));
  // a quick BUGFIX still gets the debug conditional
  const fix = selectPath({ intent: "fix the flaky test", retrieved: [] });
  assert.ok(has(fix, "debug"), "quick bugfix still routes through debug");
});

test("BLOCKER #3: a QUICK intent SKIPS heavy gated conditionals entirely (not gate-stripped) + is gate-free", () => {
  // "rename" → quick; "ui"/"button" matches the ui conditional, which is gate:true (heavy design contract).
  // A quick task must NOT drag in the UI gate at all — the old code inserted it gate-stripped (silent no-op +
  // path inflation). Now the gated conditional is skipped on the quick path.
  const p = selectPath({ intent: "rename the ui button layout", retrieved: [] });
  assert.ok(!has(p, "ui"), "the heavy gated ui conditional is SKIPPED on a quick path, not inserted gate-less");
  // sanity: the same conditional carries a gate on the full (non-quick) backbone
  const full = selectPath({ intent: "build a ui button layout", retrieved: [] });
  assert.ok(full.find((s) => s.verb === "ui")!.gate, "ui gate present on the full backbone");
  // the whole quick path remains gate-free (the driven gsd-quick run never halts)
  assert.ok(p.every((s) => !s.gate), "no step on the quick path may halt the driven run");
  // a NON-gated long-tail conditional (debug) is still a legit small addition on a quick path
  const dbg = selectPath({ intent: "rename the flaky debug helper", retrieved: [] });
  assert.ok(has(dbg, "debug"), "non-gated conditionals still apply on quick paths");
});

test("WR-01: an empty or whitespace-only intent yields an empty path (no work to drive)", () => {
  assert.deepEqual(selectPath({ intent: "", retrieved: [] }), []);
  assert.deepEqual(selectPath({ intent: "   ", retrieved: [] }), []);
});

test("PATH-01: a keyword+consensus conditional inserts the stage EXACTLY ONCE (no double-insert)", () => {
  // "debug the crash" matches the debug keyword, AND two workflow:debug docs satisfy consensus.
  // Both signals true must not push the debug stage twice.
  const p = selectPath({
    intent: "debug the crash",
    retrieved: [{ docId: "workflow:debug-1" }, { docId: "workflow:debug-2" }],
  });
  assert.equal(p.filter((s) => s.verb === "debug").length, 1, "debug inserted once despite keyword+consensus");
});

test("PATH-01: retrieval consensus is case-insensitive (docIds lowercased before matching)", () => {
  // No debug keyword in "build a thing"; debug must enter via case-insensitive workflow:debug consensus.
  const p = selectPath({
    intent: "build a thing",
    retrieved: [{ docId: "WORKFLOW:DEBUG-1" }, { docId: "WORKFLOW:DEBUG-2" }],
  });
  assert.ok(has(p, "debug"), "uppercase workflow:DEBUG docs still satisfy consensus");
});

test("WR-04: pos-collision ordering is deterministic — research before ui, stable across calls", () => {
  for (let i = 0; i < 3; i++) {
    const p = selectPath({ intent: "build a react dashboard", retrieved: [] });
    assert.ok(has(p, "ui"), "ui present");
    assert.ok(idx(p, "research") < idx(p, "ui"), "research (pos30) before ui (pos30) by verb tiebreaker");
  }
});

test("PATH-01 invariant: verify always precedes ship; output ordered non-decreasing by pos", () => {
  for (const intent of ["build a feature", "refactor the auth module", "build a secure react ai dashboard with a flaky bug"]) {
    const p = selectPath({ intent, retrieved: [] });
    if (has(p, "verify") && has(p, "ship")) {
      assert.ok(idx(p, "verify") < idx(p, "ship"), `verify before ship for "${intent}"`);
    }
    // Output must be ordered non-decreasing by pos (lifecycle order). Re-derive pos from the backbone
    // ordering: a stage's index in the canonical lifecycle must never decrease across the path.
    const order = ["spike", "discuss", "map-codebase", "research", "ui", "ai-integration", "plan", "debug", "execute", "secure", "code-review", "verify", "graphify", "docs", "ship"];
    const positions = p.map((s) => order.indexOf(s.verb));
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `lifecycle order strictly increasing for "${intent}" at ${p[i].verb}`);
    }
  }
});
