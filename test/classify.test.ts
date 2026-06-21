import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/engage/classify.js";


test("WR-03: 'failover' does not mis-route to debug (fail-substring fixed)", () => {
  assert.equal(classifyIntent("build a failover service").category, "phase");
  assert.equal(classifyIntent("the login flow fails intermittently").category, "debug", "real failure still debug");
});

test("WR-01: gratitude swallows an acknowledgement but NOT a real forward request", () => {
  assert.equal(classifyIntent("thanks for building that").engage, false, "ack stays chat");
  assert.equal(classifyIntent("thanks!").engage, false);
  const req = classifyIntent("thanks, now refactor the auth module");
  assert.ok(req.engage && req.category === "phase", "a real request after thanks engages");
});
