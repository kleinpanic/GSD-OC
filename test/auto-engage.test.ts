import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { autoEngageHandler, isCodingWorkspace, GSD_META_PROMPT } from "../src/hooks/auto-engage.js";
import { classifyIntent } from "../src/engage/classify.js";

const evt = { prompt: "do work", messages: [] };
const codeWS = join(homedir(), "codeWS", "SomeProject");

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
  // isCodingWorkspace is rooted at ~/codeWS, so use a real temp project under it would be
  // unsafe; instead drive the marker check via a cwd that IS a coding workspace by stubbing
  // workspaceDir to a temp dir under ~/codeWS and placing the marker there.
  const dir = mkdtempSync(join(homedir(), "codeWS", "gsd-ae-"));
  try {
    // coding prompt, no marker -> fires
    assert.ok(autoEngageHandler(evt, { workspaceDir: dir }));
    // marker present -> suppressed
    writeFileSync(join(dir, ".gsd-off"), "");
    assert.equal(autoEngageHandler(evt, { workspaceDir: dir }), undefined);
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
  const dir = mkdtempSync(join(homedir(), "codeWS", "gsd-mk-")); // use a temp dir we can mark
  try {
    // create a temp OUTSIDE codeWS to prove marker-based (not root-based) detection. Use
    // tmpdir() (not homedir()) because activation now walks UP for markers and ~/.planning is a
    // real GSD marker — a homedir() child would inherit it and the no-marker baseline would fail.
    const outside = mkdtempSync(join(tmpdir(), "gsd-outside-"));
    try {
      assert.equal(isCodingWorkspace(outside, ["/nonexistent-root"]), false, "no marker, not under root → false");
      writeFileSync(join(outside, "package.json"), "{}");
      assert.equal(isCodingWorkspace(outside, ["/nonexistent-root"]), true, "package.json marker → coding workspace");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
