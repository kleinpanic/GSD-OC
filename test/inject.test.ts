import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { enqueueNextTurn, instructionFor, type NextTurnInjectionApi } from "../src/orchestrate/inject.js";
import type { RouteResult } from "../src/engine/route.js";

const here = dirname(fileURLToPath(import.meta.url));

const rr = (over: Partial<RouteResult>): RouteResult => ({
  route: 3,
  action: "plan-phase",
  phase: "4",
  reason: "test",
  ...over,
});

function mockApi(): { api: NextTurnInjectionApi; calls: unknown[] } {
  const calls: unknown[] = [];
  const api: NextTurnInjectionApi = {
    session: {
      workflow: {
        async enqueueNextTurnInjection(inj) {
          calls.push(inj);
          return { enqueued: true, id: "inj-1", sessionKey: inj.sessionKey };
        },
      },
    },
  };
  return { api, calls };
}

test("instructionFor: gate action contains sessions_spawn + route→agentId (ORCH-02)", () => {
  const text = instructionFor(rr({ action: "discuss-phase", route: 1 }));
  assert.match(text, /sessions_spawn/);
  assert.match(text, /gsd-planner/);
  const v = instructionFor(rr({ action: "verify-work", route: 5 }));
  assert.match(v, /sessions_spawn/);
  assert.match(v, /gsd-verifier/);
});

test("instructionFor: mechanical action carries verb+phase, NO raw .planning/ body (V5)", () => {
  const text = instructionFor(rr({ action: "execute-phase", route: 4, phase: "4" }));
  assert.match(text, /execute-phase/);
  assert.match(text, /4/);
  assert.doesNotMatch(text, /\.planning\/phases\/.*\.md/);
  assert.doesNotMatch(text, /sessions_spawn/);
});

test("enqueueNextTurn: calls non-deprecated workflow facade ONCE with deterministic idempotencyKey (D-05)", async () => {
  const { api, calls } = mockApi();
  const next = rr({ action: "execute-phase", route: 4, phase: "4" });
  const res = await enqueueNextTurn(api, "agent:gsd-executor:main", next);
  assert.equal(res.enqueued, true);
  assert.equal(calls.length, 1);
  const inj = calls[0] as { sessionKey: string; text: string; idempotencyKey?: string; placement?: string };
  assert.equal(inj.sessionKey, "agent:gsd-executor:main");
  assert.equal(inj.idempotencyKey, "gsd:4:execute-phase");
  assert.equal(inj.placement, "prepend_context");
  assert.equal(inj.text, instructionFor(next));
});

test("enqueueNextTurn: gate action injection text contains sessions_spawn (ORCH-02 carrier)", async () => {
  const { api, calls } = mockApi();
  await enqueueNextTurn(api, "sk", rr({ action: "discuss-phase", route: 1 }));
  const inj = calls[0] as { text: string };
  assert.match(inj.text, /sessions_spawn/);
});

test("inject.ts NEVER references the deprecated flat api.enqueueNextTurnInjection alias", () => {
  const src = readFileSync(join(here, "..", "..", "src", "orchestrate", "inject.ts"), "utf8");
  // strip comment lines, then assert no `api.enqueueNextTurnInjection` (flat, deprecated).
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
    .join("\n");
  assert.doesNotMatch(code, /api\.enqueueNextTurnInjection/);
  assert.match(code, /session\.workflow\.enqueueNextTurnInjection/);
});
