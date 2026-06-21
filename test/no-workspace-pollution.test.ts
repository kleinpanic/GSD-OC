/**
 * ENFORCEMENT for canonicalism — this test FAILS THE BUILD if any test source could pollute the user's real
 * workspace with fixture dirs. It is the guardrail that the 59-leaked-dirs incident proved was missing: prose in
 * CONTRIBUTING.md is not enforcement; a failing test is.
 *
 * Rules enforced across every test/ *.ts source:
 *   1. No test may create a dir under `homedir()` (i.e. `~/codeWS` or any home child) — fixtures belong in
 *      os.tmpdir() (OS-reaped) only.
 *   2. Direct `mkdtempSync` / `mkdirSync` under `homedir()` is banned (the exact pattern that leaked).
 * The canonical way to make a fixture is `test/helpers/scratch.ts` (scratchDir / scratchProject), which is always
 * under os.tmpdir()/gsd-oc-tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolve the SOURCE test dir (…/test), not the compiled dist-test copy, so we lint the real .ts sources.
const compiledDir = dirname(fileURLToPath(import.meta.url)); // …/dist-test/test
const repoRoot = join(compiledDir, "..", ".."); // …/ (repo)
const testSrcDir = join(repoRoot, "test");

/** Patterns that write fixtures into the user's home/workspace — the pollution this incident was about. */
const BANNED: { re: RegExp; why: string }[] = [
  { re: /mkdtempSync\s*\(\s*join\s*\(\s*homedir\s*\(\)/, why: "mkdtempSync under homedir() leaks into the user's workspace — use test/helpers/scratch.ts (os.tmpdir())" },
  { re: /mkdirSync\s*\(\s*join\s*\(\s*homedir\s*\(\)\s*,\s*["']codeWS["']/, why: "mkdirSync under ~/codeWS pollutes the real workspace — use scratchDir()/scratchProject()" },
  { re: /writeFileSync\s*\(\s*join\s*\(\s*homedir\s*\(\)/, why: "writeFileSync under homedir() touches the user's home — use a scratch dir" },
];

function testSources(): { name: string; text: string }[] {
  return readdirSync(testSrcDir)
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => f !== "no-workspace-pollution.test.ts") // this file names the patterns in its rules
    .map((f) => ({ name: f, text: readFileSync(join(testSrcDir, f), "utf8") }));
}

test("ENFORCEMENT: no test source creates fixture dirs under the user's home/workspace (~/codeWS)", () => {
  const violations: string[] = [];
  for (const { name, text } of testSources()) {
    for (const { re, why } of BANNED) {
      if (re.test(text)) violations.push(`${name}: ${why}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Test fixtures must live in os.tmpdir() (via test/helpers/scratch.ts), NEVER ~/codeWS — the 59-leaked-dirs class of bug:\n  ${violations.join("\n  ")}`,
  );
});

test("ENFORCEMENT: the canonical scratch helper stays under os.tmpdir(), never homedir()", async () => {
  const { SCRATCH_ROOT } = await import("./helpers/scratch.js");
  const { tmpdir, homedir } = await import("node:os");
  assert.ok(SCRATCH_ROOT.startsWith(tmpdir()), "SCRATCH_ROOT must be under os.tmpdir()");
  assert.ok(!SCRATCH_ROOT.startsWith(homedir()) || tmpdir().startsWith(homedir()), "SCRATCH_ROOT must not be under homedir() (unless tmpdir itself is, e.g. macOS)");
});
