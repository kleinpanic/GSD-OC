import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutoRepo, type CmdRunner } from "../src/engine/repo.js";

// a mock gh/git runner driven by a state map
function mockRun(state: { ghInstalled?: boolean; ghAuthed?: boolean; origin?: string; repoExists?: boolean; createOk?: boolean; created?: string[] }): CmdRunner {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    if (key.startsWith("gh --version")) return { ok: state.ghInstalled !== false, stdout: "gh 2", code: 0 };
    if (key.startsWith("gh auth status")) return { ok: state.ghAuthed !== false, stdout: "", code: 0 };
    if (key.startsWith("git remote get-url origin")) return { ok: !!state.origin, stdout: state.origin ?? "", code: state.origin ? 0 : 1 };
    if (key.startsWith("gh repo view")) return { ok: !!state.repoExists, stdout: "", code: state.repoExists ? 0 : 1 };
    if (key.startsWith("git rev-parse")) return { ok: true, stdout: "true", code: 0 };
    if (key.startsWith("gh repo create")) { (state.created ??= []).push(key); return { ok: state.createOk !== false, stdout: "", code: 0 }; }
    return { ok: true, stdout: "", code: 0 };
  };
}

test("SECURITY: argv-injection — a flag-smuggling repo name is rejected", () => {
  for (const bad of ["--upload-pack=x", "-x", ".hidden", "a/b", "a b", "a;rm"]) {
    const r = createAutoRepo("/r", "private", { name: bad, run: mockRun({}) });
    assert.match(r.skipped!, /invalid repo name/, bad);
  }
  assert.match(createAutoRepo("/r", "private", { name: "ok", owner: "--evil", run: mockRun({}) }).skipped!, /invalid repo owner/);
});

test("auto-repo off → skipped", () => {
  assert.deepEqual(createAutoRepo("/r", "off", { run: mockRun({}) }).skipped, "auto_repo=off");
});
test("guard: gh not installed / not authed → skipped, needsUser", () => {
  assert.match(createAutoRepo("/r", "private", { run: mockRun({ ghInstalled: false }) }).skipped!, /not installed/);
  assert.match(createAutoRepo("/r", "private", { run: mockRun({ ghAuthed: false }) }).skipped!, /not authenticated/);
});
test("guard: existing origin is NEVER clobbered", () => {
  const r = createAutoRepo("/r", "private", { run: mockRun({ origin: "git@github.com:me/x.git" }) });
  assert.match(r.skipped!, /origin already/);
  assert.equal(r.created, "git@github.com:me/x.git");
});
test("guard: repo-name collision HALTS and asks", () => {
  const r = createAutoRepo("/r", "private", { name: "x", run: mockRun({ repoExists: true }) });
  assert.match(r.halt!, /already exists/);
  assert.ok(r.needsUser);
});
test("private create succeeds (default), keeps .planning", () => {
  const st = { created: [] as string[] };
  const r = createAutoRepo("/r", "private", { name: "myproj", run: mockRun(st) });
  assert.equal(r.created, "https://github.com/myproj");
  assert.equal(r.visibility, "private");
  assert.ok(!r.planningStripped);
  assert.ok(st.created[0].includes("--private"));
});
test("public create gitignores .planning before push (privacy invariant)", () => {
  const repo = mkdtempSync(join(tmpdir(), "gsd-repo-"));
  try {
    const r = createAutoRepo(repo, "public", { name: "pub", run: mockRun({}) });
    assert.equal(r.visibility, "public");
    assert.ok(r.planningStripped);
    assert.match(readFileSync(join(repo, ".gitignore"), "utf8"), /^\.planning\/$/m);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
