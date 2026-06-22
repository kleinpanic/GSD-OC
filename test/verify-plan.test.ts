import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { verifyPlanStructure, verifyReferences, verifyCommits } from "../src/engine/verify-plan.js";
import { getRoadmapPhase } from "../src/engine/verify.js";
import { scratchDir, cleanupAllScratch } from "./helpers/scratch.js";

after(cleanupAllScratch);

const FULL_PLAN = `---
phase: 2
plan: 1
type: implementation
wave: 1
depends_on: []
files_modified: [src/a.ts]
autonomous: true
must_haves:
  artifacts: []
---

# Plan

<task>
<name>build the thing</name>
<action>write code</action>
<verify>run tests</verify>
<done>tests pass</done>
<files>src/a.ts</files>
</task>
`;

test("verifyPlanStructure: a complete plan is valid", () => {
  const d = scratchDir("vp");
  writeFileSync(join(d, "PLAN.md"), FULL_PLAN);
  const r = verifyPlanStructure("PLAN.md", d) as { valid: boolean; task_count: number; errors: string[] };
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.equal(r.task_count, 1);
});

test("verifyPlanStructure: missing frontmatter fields + missing action are errors; missing verify is a warning", () => {
  const d = scratchDir("vp2");
  writeFileSync(join(d, "PLAN.md"), "---\nphase: 1\n---\n\n<task>\n<name>x</name>\n</task>\n");
  const r = verifyPlanStructure("PLAN.md", d) as { valid: boolean; errors: string[]; warnings: string[] };
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("must_haves")), "missing field error");
  assert.ok(r.errors.some((e) => e.includes("missing <action>")), "missing action error");
  assert.ok(r.warnings.some((w) => w.includes("missing <verify>")), "missing verify warning");
});

test("verifyPlanStructure: checkpoint task requires autonomous:false", () => {
  const d = scratchDir("vp3");
  const plan = FULL_PLAN.replace("autonomous: true", "autonomous: true").replace("<task>", '<task type="checkpoint">');
  writeFileSync(join(d, "PLAN.md"), plan);
  const r = verifyPlanStructure("PLAN.md", d) as { errors: string[] };
  assert.ok(r.errors.some((e) => e.includes("autonomous is not false")));
});

test("verifyPlanStructure: missing file → error", () => {
  assert.deepEqual(verifyPlanStructure("nope.md", scratchDir("vp4")), { error: "File not found", path: "nope.md" });
});

test("verifyReferences: resolves @-refs + backtick paths, reports missing", () => {
  const d = scratchDir("vr");
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "real.ts"), "x");
  writeFileSync(join(d, "DOC.md"), "see @src/real.ts and `src/real.ts` but also @src/ghost.ts and `lib/missing.js`\n");
  const r = verifyReferences("DOC.md", d) as { valid: boolean; found: number; missing: string[] };
  assert.equal(r.valid, false);
  assert.ok(r.found >= 1, "real.ts found");
  assert.deepEqual(r.missing.sort(), ["lib/missing.js", "src/ghost.ts"]);
});

test("verifyReferences: skips urls + template vars", () => {
  const d = scratchDir("vr2");
  writeFileSync(join(d, "DOC.md"), "`https://x.com/a.js` and `${VAR}/x.ts` should be skipped\n");
  const r = verifyReferences("DOC.md", d) as { total: number };
  assert.equal(r.total, 0, "no real refs counted");
});

test("verifyCommits classifies real vs bogus hashes", () => {
  const d = scratchDir("vc");
  const git = (...a: string[]) => execFileSync("git", a, { cwd: d, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(d, "f.txt"), "x");
  git("add", "f.txt");
  git("commit", "-q", "-m", "init");
  const head = git("rev-parse", "HEAD");
  const r = verifyCommits(d, [head, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
  assert.deepEqual(r.valid, [head]);
  assert.deepEqual(r.invalid, ["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
  assert.equal(r.all_valid, false);
});

test("getRoadmapPhase extracts a single phase section + handles decimals + not-found", () => {
  const d = scratchDir("grp");
  mkdirSync(join(d, ".planning"), { recursive: true });
  writeFileSync(
    join(d, ".planning", "ROADMAP.md"),
    "# Roadmap\n\n### Phase 1: Foundations\n**Goal:** core\n\n### Phase 2.5: Hotfix\n**Goal:** patch\n\n### Phase 3: Polish\n**Goal:** ship\n",
  );
  const p = join(d, ".planning");
  const one = getRoadmapPhase(p, 1) as { found: boolean; name: string; section: string };
  assert.equal(one.found, true);
  assert.equal(one.name, "Foundations");
  assert.match(one.section, /\*\*Goal:\*\* core/);
  assert.doesNotMatch(one.section, /Phase 2\.5/, "section stops at the next phase heading");
  const dec = getRoadmapPhase(p, "2.5") as { found: boolean; name: string };
  assert.equal(dec.name, "Hotfix");
  assert.equal((getRoadmapPhase(p, 9) as { found: boolean }).found, false);
});
