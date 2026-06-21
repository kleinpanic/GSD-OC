import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { readGsdConfig, setGsdConfigKey, defaultGsdConfig } from "../src/engine/config.js";

test("H-1: a __proto__ key in config.json does not pollute the returned config's prototype", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-cfg-"));
  try {
    writeFileSync(join(dir, "config.json"), '{"__proto__":{"auto_advance":true}}');
    const { config } = readGsdConfig(dir);
    assert.equal(Object.getPrototypeOf(config), Object.prototype, "prototype not replaced");
    assert.notEqual(({} as Record<string, unknown>).auto_advance, true, "Object.prototype not polluted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("H-1: a scalar override of an object-typed field is rejected (keeps the default object)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-cfg-"));
  try {
    writeFileSync(join(dir, "config.json"), '{"workflow":"haha"}');
    const { config } = readGsdConfig(dir);
    assert.equal(typeof config.workflow, "object", "workflow stays an object, not the string");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("defaults include the real upstream keys (context_coverage_gate, plan_review_convergence, graphify, drift)", () => {
  const d = defaultGsdConfig();
  const w = d.workflow as Record<string, unknown>;
  assert.equal(w.context_coverage_gate, true);
  assert.equal(w.plan_review_convergence, false);
  assert.equal(w.drift_threshold, 3);
  assert.equal(w.drift_action, "warn");
  assert.deepEqual(d.graphify, { enabled: false, build_timeout: 300 });
});

test("CFG-03: setGsdConfigKey writes a coerced nested key into SPARSE overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-cfg-"));
  try {
    // boolean coercion from a string, into a freshly-created (no prior file) sparse config
    const r = setGsdConfigKey(dir, "workflow.tdd_mode", "true");
    assert.equal(r.ok, true);
    assert.equal(r.value, true);
    // persisted file is SPARSE (only the set key), not the full defaulted config
    const raw = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    assert.deepEqual(raw, { workflow: { tdd_mode: true } });
    // it reads back through the defaulted layer
    assert.equal(readGsdConfig(dir).config.workflow.tdd_mode, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CFG-03: setGsdConfigKey preserves existing overrides + coerces number", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-cfg-"));
  try {
    writeFileSync(join(dir, "config.json"), '{"workflow":{"tdd_mode":true}}');
    const r = setGsdConfigKey(dir, "workflow.subagent_timeout", "120000");
    assert.equal(r.ok, true);
    assert.equal(r.value, 120000);
    const raw = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    assert.deepEqual(raw, { workflow: { tdd_mode: true, subagent_timeout: 120000 } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CFG-03: setGsdConfigKey rejects unknown keys, sections, prototype pollution, bad coercion", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-cfg-"));
  try {
    assert.equal(setGsdConfigKey(dir, "workflow.not_a_real_key", true).ok, false, "unknown key rejected");
    assert.equal(setGsdConfigKey(dir, "workflow", {}).ok, false, "section (non-leaf) rejected");
    assert.equal(setGsdConfigKey(dir, "__proto__.polluted", true).ok, false, "reserved segment rejected");
    assert.equal(setGsdConfigKey(dir, "workflow.tdd_mode", "maybe").ok, false, "non-boolean for boolean rejected");
    assert.equal(setGsdConfigKey(dir, "workflow.subagent_timeout", "abc").ok, false, "non-number for number rejected");
    // none of the rejects wrote a file
    assert.throws(() => readFileSync(join(dir, "config.json"), "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CFG-03: setGsdConfigKey coerces an array from a comma string + nulls a nullable", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-cfg-"));
  try {
    assert.deepEqual(setGsdConfigKey(dir, "review.external", "codex, gemini").value, ["codex", "gemini"]);
    assert.equal(setGsdConfigKey(dir, "project_code", "null").value, null);
    assert.equal(setGsdConfigKey(dir, "project_code", "GSDOC").value, "GSDOC");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
