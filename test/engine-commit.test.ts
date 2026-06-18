import { test } from "node:test";
import assert from "node:assert/strict";
import { commitFiles } from "../src/engine/commit.js";

test("dry-run builds add argv from explicit names — never -A, never '.'", () => {
  const files = ["src/engine/state.ts", "src/engine/route.ts"];
  const r = commitFiles(files, "feat: x", { dryRun: true });
  assert.equal(r.committed, false);
  // add argv stages by name behind a `--` guard
  assert.deepEqual(r.addArgv, ["add", "--", "src/engine/state.ts", "src/engine/route.ts"]);
  for (const f of files) assert.ok(r.addArgv.includes(f), `${f} appears in add argv`);
  assert.ok(!r.addArgv.includes("-A"), "no -A");
  assert.ok(!r.addArgv.includes("."), "no bare '.'");
});

test("dry-run commit argv carries -m and the message, never --no-verify", () => {
  const r = commitFiles(["a.ts"], "fix: thing", { dryRun: true });
  assert.ok(r.commitArgv.includes("-m"), "commit uses -m");
  assert.ok(r.commitArgv.includes("fix: thing"), "message present");
  assert.ok(!r.commitArgv.includes("--no-verify"), "never --no-verify");
});

test("no signing flags are injected — GPG inherited from user git config", () => {
  const r = commitFiles(["a.ts"], "msg", { dryRun: true });
  const all = [...r.addArgv, ...r.commitArgv];
  for (const flag of ["-S", "--gpg-sign", "--no-gpg-sign"]) {
    assert.ok(!all.includes(flag), `argv must not contain ${flag}`);
  }
});

test("empty file list throws", () => {
  assert.throws(() => commitFiles([], "msg", { dryRun: true }), /no files to stage/);
});
