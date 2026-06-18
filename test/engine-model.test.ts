import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModel } from "../src/engine/model.js";

test("balanced profile maps a heavy-tier agent to its balanced model", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "balanced" }), "opus");
});

test("budget profile maps the same agent to its budget model", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "budget" }), "sonnet");
});

test("quality profile maps to the agent's golden model", () => {
  assert.equal(resolveModel("gsd-verifier", { model_profile: "quality" }), "sonnet");
  assert.equal(resolveModel("gsd-verifier", { model_profile: "budget" }), "haiku");
});

test("adaptive profile resolves via routingTier → adaptiveTierMap", () => {
  // gsd-executor routingTier standard → sonnet
  assert.equal(resolveModel("gsd-executor", { model_profile: "adaptive" }), "sonnet");
  // gsd-planner routingTier heavy → opus
  assert.equal(resolveModel("gsd-planner", { model_profile: "adaptive" }), "opus");
});

test("inherit profile returns 'inherit' (no concrete model)", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "inherit" }), "inherit");
});

test("per-agent override wins over the profile lookup", () => {
  const cfg = {
    model_profile: "balanced",
    model_profile_overrides: { "gsd-planner": "haiku" },
  };
  assert.equal(resolveModel("gsd-planner", cfg), "haiku");
});

test("unknown profile falls back to balanced", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "nonsense" }), "opus");
  // empty config → balanced default
  assert.equal(resolveModel("gsd-executor", {}), "sonnet");
});

test("unknown agent with no override resolves to null", () => {
  assert.equal(resolveModel("gsd-nonexistent", { model_profile: "balanced" }), null);
});
