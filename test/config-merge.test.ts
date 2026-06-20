import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGsdConfig } from "../src/engine/config.js";

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
