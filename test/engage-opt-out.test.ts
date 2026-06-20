import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  optedOut,
  hasGsdOffMarker,
  configDisablesEngage,
  parseToggle,
} from "../src/engage/opt-out.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gsd-optout-"));
}

test("hasGsdOffMarker: cwd marker (D-02)", () => {
  const dir = tmpProject();
  try {
    assert.equal(hasGsdOffMarker(dir), false);
    writeFileSync(join(dir, ".gsd-off"), "");
    assert.equal(hasGsdOffMarker(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasGsdOffMarker: .planning/.gsd-off marker (D-02)", () => {
  const dir = tmpProject();
  try {
    mkdirSync(join(dir, ".planning"));
    writeFileSync(join(dir, ".planning", ".gsd-off"), "");
    assert.equal(hasGsdOffMarker(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("configDisablesEngage: disabled / autoEngage flags (D-04)", () => {
  assert.equal(configDisablesEngage({ disabled: true }), true);
  assert.equal(configDisablesEngage({ autoEngage: false }), true);
  assert.equal(configDisablesEngage({}), false);
  assert.equal(configDisablesEngage(undefined), false);
  assert.equal(configDisablesEngage({ disabled: false, autoEngage: true }), false);
  // Malformed / unknown keys must NOT silently opt out (T-05-01).
  assert.equal(configDisablesEngage({ disabled: "yes" }), false);
});

test("parseToggle: off/on/null (D-03)", () => {
  assert.equal(parseToggle("gsd off"), "off");
  assert.equal(parseToggle("gsd: off"), "off");
  assert.equal(parseToggle("disable gsd"), "off");
  assert.equal(parseToggle("GSD ON"), "on");
  assert.equal(parseToggle("enable gsd"), "on");
  assert.equal(parseToggle("hello"), null);
  assert.equal(parseToggle(""), null);
});

test("parseToggle: directive-shape anchor rejects incidental 'gsd on' (WR-04)", () => {
  // "is gsd on the roadmap" is a question, not a directive — must NOT toggle.
  assert.equal(parseToggle("is gsd on the roadmap"), null);
  // Leading directive still wins; "first match" resolves a contradictory tail.
  assert.equal(parseToggle("gsd off then on"), "off");
});

test("hasGsdOffMarker: .gsd-off in a PARENT dir suppresses a child cwd (WR-02)", () => {
  const root = tmpProject();
  try {
    writeFileSync(join(root, ".gsd-off"), "");
    const child = join(root, "packages", "foo");
    mkdirSync(child, { recursive: true });
    assert.equal(hasGsdOffMarker(child), true, "ancestor .gsd-off opts the subdir out");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("optedOut: each mechanism independently suppresses (ENG-03)", () => {
  const dir = tmpProject();
  try {
    // none apply
    assert.equal(optedOut({ cwd: dir }), false);
    // marker
    writeFileSync(join(dir, ".gsd-off"), "");
    assert.equal(optedOut({ cwd: dir }), true);
    rmSync(join(dir, ".gsd-off"));
    assert.equal(optedOut({ cwd: dir }), false);
    // config
    assert.equal(optedOut({ cwd: dir, pluginConfig: { disabled: true } }), true);
    assert.equal(optedOut({ cwd: dir, pluginConfig: { autoEngage: false } }), true);
    // session
    assert.equal(optedOut({ cwd: dir, sessionDisabled: true }), true);
    assert.equal(optedOut({ cwd: dir, sessionDisabled: false }), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("L-1: a .gsd-off ABOVE the home dir is out of scope; one inside the project is honored", () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-l1-"));
  const home = join(base, "home");
  const proj = join(home, "codeWS", "proj");
  mkdirSync(proj, { recursive: true });
  try {
    writeFileSync(join(base, ".gsd-off"), ""); // ABOVE the fake home — must be ignored
    assert.equal(hasGsdOffMarker(proj, home), false, "marker above home is out of scope");
    writeFileSync(join(proj, ".gsd-off"), ""); // inside the project — honored
    assert.equal(hasGsdOffMarker(proj, home), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
