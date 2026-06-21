import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { autoEngageHandler, isCodingWorkspace, GSD_META_PROMPT } from "../src/hooks/auto-engage.js";
import { classifyIntent } from "../src/engage/classify.js";

const evt = { prompt: "do work", messages: [] };
// A real project path follows the machine's convention: codeWS/<Lang>/<Project> (depth-2), not codeWS/<Project>.
const codeWS = join(homedir(), "codeWS", "JavaScript", "SomeProject");

test("auto-engage fires inside ~/codeWS (ENG-02)", () => {
  const ctx = { workspaceDir: codeWS };
  const r = autoEngageHandler(evt, ctx);
  assert.ok(r, "expected an injection result");
  assert.equal(r!.prependSystemContext, GSD_META_PROMPT);
});

test("auto-engage does NOT fire outside coding workspaces (ENG-04 negative)", () => {
  assert.equal(autoEngageHandler(evt, { workspaceDir: "/tmp/random" }), undefined);
});

test("auto-engage: missing workspaceDir falls back to process.cwd() (cross-AI F5 fix)", () => {
  // The suite runs inside ~/codeWS, so an absent workspaceDir resolves to a coding workspace and fires.
  // A missing ctx must NOT silently block activation when the real cwd is a coding workspace.
  assert.ok(autoEngageHandler(evt, {}), "no workspaceDir → process.cwd() (in codeWS here) → fires");
});

test("Phase-1 backward-compat: 'do work' still classifies as engage (D-06)", () => {
  assert.equal(classifyIntent("do work").engage, true);
});

test("ENG-04 negative inside codeWS: chat prompt -> no injection (D-05)", () => {
  const r = autoEngageHandler({ prompt: "hi there", messages: [] }, { workspaceDir: codeWS });
  assert.equal(r, undefined);
});

test("opt-out: .gsd-off marker suppresses a coding prompt in codeWS (ENG-03/D-02)", () => {
  // Create the fixture in os.tmpdir() (auto-reaped, never pollutes ~/codeWS) and register it as a coding root
  // via pluginConfig.codingRoots — the handler then treats it as a coding workspace without needing ~/codeWS.
  const dir = mkdtempSync(join(tmpdir(), "gsd-ae-"));
  const deps = { pluginConfig: { codingRoots: [dir] } };
  try {
    // coding prompt, no marker -> fires
    assert.ok(autoEngageHandler(evt, { workspaceDir: dir }, deps));
    // marker present -> suppressed
    writeFileSync(join(dir, ".gsd-off"), "");
    assert.equal(autoEngageHandler(evt, { workspaceDir: dir }, deps), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opt-out: pluginConfig flag suppresses injection (ENG-03/D-04)", () => {
  assert.equal(
    autoEngageHandler(evt, { workspaceDir: codeWS }, { pluginConfig: { disabled: true } }),
    undefined,
  );
  assert.equal(
    autoEngageHandler(evt, { workspaceDir: codeWS }, { pluginConfig: { autoEngage: false } }),
    undefined,
  );
});

test("opt-out: sessionDisabled flag suppresses injection (ENG-03/D-03)", () => {
  assert.equal(
    autoEngageHandler(evt, { workspaceDir: codeWS }, { sessionDisabled: true }),
    undefined,
  );
});

test("isCodingWorkspace path containment", () => {
  const roots = ["/home/x/codeWS"];
  assert.equal(isCodingWorkspace("/home/x/codeWS", roots), true);
  assert.equal(isCodingWorkspace("/home/x/codeWS/a/b", roots), true);
  // /tmp/random-non-project has no marker and is outside the root → not a coding workspace
  assert.equal(isCodingWorkspace("/home/x/codeWSX", roots), false);
  assert.equal(isCodingWorkspace(undefined, roots), false);
});

test("isCodingWorkspace walks UP to an ancestor marker for a coding SUBDIR (WR-01)", () => {
  // package.json in the project ROOT; query a nested subdir (src/) outside any root.
  const root = mkdtempSync(join(tmpdir(), "gsd-mkup-"));
  try {
    writeFileSync(join(root, "package.json"), "{}");
    const nested = join(root, "packages", "foo", "src");
    mkdirSync(nested, { recursive: true });
    assert.equal(
      isCodingWorkspace(nested, ["/nonexistent-root"]),
      true,
      "ancestor package.json → subdir is a coding workspace",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isCodingWorkspace: a dir with NO ancestor markers → false (walk-up negative)", () => {
  // A clean tmp dir + nested subdir, no markers anywhere up to root → not a coding workspace.
  const dir = mkdtempSync(join(tmpdir(), "gsd-nomarker-"));
  try {
    const nested = join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    assert.equal(isCodingWorkspace(nested, ["/nonexistent-root"]), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isCodingWorkspace: filesystem root '/' → false (bounded walk terminates)", () => {
  assert.equal(isCodingWorkspace("/", ["/nonexistent-root"]), false);
});

test("isCodingWorkspace fires by MARKER outside any root (the auto-engage gap fix)", () => {
  // A dir with a coding marker (.git/package.json/.planning) is a coding workspace regardless of path —
  // this is what makes GSD auto-engage in agent workspaces (~/.openclaw/workspace-*) not under ~/codeWS.
  // Fixtures live in os.tmpdir() (auto-reaped) — NEVER ~/codeWS — so a missed cleanup can't pollute the workspace.
  const outside = mkdtempSync(join(tmpdir(), "gsd-outside-"));
  try {
    assert.equal(isCodingWorkspace(outside, ["/nonexistent-root"]), false, "no marker, not under root → false");
    writeFileSync(join(outside, "package.json"), "{}");
    assert.equal(isCodingWorkspace(outside, ["/nonexistent-root"]), true, "package.json marker → coding workspace");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

import { resolveEngageConfig } from "../src/hooks/auto-engage.js";

test("CONFIG: engageMode 'intent' engages on coding intent ANYWHERE (no cwd requirement)", () => {
  const r = autoEngageHandler(evt, { workspaceDir: "/tmp/not-a-project" }, { pluginConfig: { engageMode: "intent" } });
  assert.ok(r, "intent mode engages outside any coding workspace");
  // but still respects the intent gate — pure chat does not engage
  assert.equal(autoEngageHandler({ prompt: "hi", messages: [] }, { workspaceDir: "/tmp/x" }, { pluginConfig: { engageMode: "intent" } }), undefined);
});

test("CONFIG: engageMode 'off' never engages, even in a coding workspace", () => {
  assert.equal(autoEngageHandler(evt, { workspaceDir: codeWS }, { pluginConfig: { engageMode: "off" } }), undefined);
});

test("CONFIG: codingRoots adds a custom dir as a coding workspace (marker-less)", () => {
  const dir = mkdtempSync(join(tmpdir(), "myproj-")); // no marker, not under codeWS
  try {
    assert.equal(autoEngageHandler(evt, { workspaceDir: dir }), undefined, "unconfigured marker-less dir → no engage");
    const r = autoEngageHandler(evt, { workspaceDir: dir }, { pluginConfig: { codingRoots: [dir] } });
    assert.ok(r, "configured root engages");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CONFIG: includeDefaultRoot:false drops the built-in $HOME/codeWS default", () => {
  const cfg = resolveEngageConfig({ includeDefaultRoot: false });
  assert.equal(cfg.roots.length, 0, "no default root when disabled");
  const withDefault = resolveEngageConfig({});
  assert.ok(withDefault.roots.some((r) => r.endsWith("codeWS")), "default $HOME/codeWS present otherwise");
});

test("CONFIG: codingRoots expands ~ and $VAR", () => {
  process.env.GSD_TEST_ROOT = "/tmp/gsdtestroot";
  const cfg = resolveEngageConfig({ codingRoots: ["~/work", "$GSD_TEST_ROOT/sub"] });
  assert.ok(cfg.roots.some((r) => r.includes("/work")), "~ expanded to home");
  assert.ok(cfg.roots.some((r) => r === "/tmp/gsdtestroot/sub"), "$VAR expanded");
});

test("STRUCTURE: the default ~/codeWS root infers <Lang>/<Project> — only depth-2 is a project", async () => {
  const { homedir } = await import("node:os");
  const root = join(homedir(), "codeWS");
  // root itself + the bare <Lang> layer are NOT projects (no marker) — the stray-dir-at-root class is excluded
  assert.equal(isCodingWorkspace(root, [root]), false, "the codeWS root is not a project");
  assert.equal(isCodingWorkspace(join(root, "JavaScript"), [root]), false, "the bare Lang layer is not a project");
  // a real project at <root>/<Lang>/<Project> (depth 2) and deeper engages
  assert.equal(isCodingWorkspace(join(root, "JavaScript", "GSD-OC"), [root]), true, "depth-2 is a project");
  assert.equal(isCodingWorkspace(join(root, "JavaScript", "GSD-OC", "src"), [root]), true, "deeper still a project");
});

test("STRUCTURE: an OPERATOR-configured root is literal (any depth), unlike the convention default", () => {
  const custom = "/srv/projects/myapp";
  // a configured root points where the operator says — the root itself engages (no depth requirement)
  assert.equal(isCodingWorkspace(custom, [custom]), true, "configured root engages at depth 0");
  assert.equal(isCodingWorkspace(join(custom, "sub"), [custom]), true, "and at any depth under it");
});
