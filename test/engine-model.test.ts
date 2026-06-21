import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModel, AGENT_CATALOG } from "../src/engine/model.js";

// Tiers are now QUALIFIED to anthropic/<tier> so they resolve on a stock (OpenAI-default) OpenClaw gateway.
test("balanced profile maps a heavy-tier agent to its balanced model (anthropic-qualified)", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "balanced" }), "anthropic/opus");
});

test("budget profile maps the same agent to its budget model", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "budget" }), "anthropic/sonnet");
});

test("quality profile maps to the agent's golden model", () => {
  assert.equal(resolveModel("gsd-verifier", { model_profile: "quality" }), "anthropic/sonnet");
  assert.equal(resolveModel("gsd-verifier", { model_profile: "budget" }), "anthropic/haiku");
});

test("adaptive profile resolves via routingTier → adaptiveTierMap (qualified)", () => {
  assert.equal(resolveModel("gsd-executor", { model_profile: "adaptive" }), "anthropic/sonnet");
  assert.equal(resolveModel("gsd-planner", { model_profile: "adaptive" }), "anthropic/opus");
});

test("model_provider config qualifies the tier under a custom provider", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "balanced", model_provider: "myprov" }), "myprov/opus");
});

test("a full provider/model override passes through unqualified (non-Anthropic users)", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile_overrides: { "gsd-planner": "glm/glm-4.6" } }), "glm/glm-4.6");
});

test("CR-03: inherit profile returns null (LEAVE the parent model, not the literal 'inherit')", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "inherit" }), null);
});

test("per-agent override wins over the profile lookup (tier qualified)", () => {
  const cfg = {
    model_profile: "balanced",
    model_profile_overrides: { "gsd-planner": "haiku" },
  };
  assert.equal(resolveModel("gsd-planner", cfg), "anthropic/haiku");
});

test("unknown profile falls back to balanced", () => {
  assert.equal(resolveModel("gsd-planner", { model_profile: "nonsense" }), "anthropic/opus");
  // empty config → balanced default
  assert.equal(resolveModel("gsd-executor", {}), "anthropic/sonnet");
});

test("unknown agent with no override resolves to null", () => {
  assert.equal(resolveModel("gsd-nonexistent", { model_profile: "balanced" }), null);
});

test("M-03: an empty-string override is treated as absent (falls through to tier)", () => {
  const cfg = {
    model_profile: "balanced",
    model_profile_overrides: { "gsd-planner": "" },
  };
  // "" must NOT win — fall through to balanced → anthropic/opus for gsd-planner.
  assert.equal(resolveModel("gsd-planner", cfg), "anthropic/opus");
});

test("M-03: an unknown bare override tier falls through to profile resolution", () => {
  const cfg = {
    model_profile: "budget",
    model_profile_overrides: { "gsd-planner": "gpt-bananas" },
  };
  // Unrecognized bare tier (no provider /) is ignored → budget → anthropic/sonnet for gsd-planner.
  assert.equal(resolveModel("gsd-planner", cfg), "anthropic/sonnet");
});

test("M-03/CR-03: a valid override tier wins; an 'inherit' override returns null (leave parent)", () => {
  assert.equal(
    resolveModel("gsd-planner", { model_profile: "balanced", model_profile_overrides: { "gsd-planner": "inherit" } }),
    null,
  );
});

test("MODEL-01: every one of the 33 roster agents has a model-catalog entry (no silent inherit)", () => {
  const ids = Object.keys(AGENT_CATALOG);
  assert.equal(ids.length, 33, "catalog covers all 33 GSD agents");
  for (const id of ids) {
    assert.notEqual(resolveModel(id, { model_profile: "balanced" }), null, `${id} resolves a model`);
  }
});
