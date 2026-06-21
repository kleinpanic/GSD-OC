import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyFile,
  detectDrift,
  chooseAffectedPaths,
  sanitizePaths,
  readMappedCommit,
  writeMappedCommit,
  DRIFT_CATEGORIES,
} from "../src/engine/drift.js";
import { scratchDir, cleanupAllScratch } from "./helpers/scratch.js";

after(cleanupAllScratch);

test("classifyFile recognizes barrel / migration / route, null otherwise", () => {
  assert.equal(classifyFile("packages/foo/src/index.ts"), "barrel");
  assert.equal(classifyFile("apps/web/src/index.tsx"), "barrel");
  assert.equal(classifyFile("supabase/migrations/20240101_init.sql"), "migration");
  assert.equal(classifyFile("prisma/migrations/20240101_init/migration.sql"), "migration");
  assert.equal(classifyFile("src/routes/users.ts"), "route");
  assert.equal(classifyFile("src/api/users.ts"), "route");
  assert.equal(classifyFile("src/lib/util.ts"), null);
  assert.deepEqual([...DRIFT_CATEGORIES], ["new_dir", "barrel", "migration", "route"]);
});

test("detectDrift: unmapped new files become new_dir; mapped ordinary files are ignored", () => {
  const structureMd = "# Structure\n\n- `src/lib/` core utilities\n";
  const r = detectDrift({
    addedFiles: ["src/lib/known.ts", "brandnew/thing.ts", "another/place.ts"],
    structureMd,
    threshold: 2,
  });
  assert.equal(r.skipped, false);
  // src/lib is mapped → ignored; the two unmapped dirs → new_dir
  assert.equal(r.elements.length, 2);
  assert.ok(r.elements.every((e) => e.category === "new_dir"));
  assert.equal(r.actionRequired, true, "2 elements >= threshold 2");
  assert.deepEqual(r.affectedPaths.sort(), ["another", "brandnew"]);
});

test("detectDrift: most-specific category wins + threshold gating", () => {
  const r = detectDrift({
    addedFiles: ["supabase/migrations/1.sql", "src/routes/a.ts", "packages/x/src/index.ts"],
    structureMd: "nothing mapped here",
    threshold: 5,
  });
  const cats = r.elements.map((e) => e.category).sort();
  assert.deepEqual(cats, ["barrel", "migration", "route"]);
  assert.equal(r.actionRequired, false, "3 elements < threshold 5 → no action");
  assert.equal(r.directive, "none");
});

test("detectDrift never throws on malformed input → skipped", () => {
  assert.equal(detectDrift(null as never).skipped, true);
  assert.equal(detectDrift({ structureMd: null }).skipped, true);
  assert.equal(detectDrift({ structureMd: 42 as never }).reason, "invalid-structure-md");
});

test("auto-remap action sets directive + spawnMapper", () => {
  const r = detectDrift({
    addedFiles: ["a/x.ts", "b/y.ts", "c/z.ts"],
    structureMd: "",
    threshold: 3,
    action: "auto-remap",
  });
  assert.equal(r.directive, "auto-remap");
  assert.equal(r.spawnMapper, true);
  assert.match(r.message, /Auto-remap scheduled/);
});

test("chooseAffectedPaths collapses to depth-2 for apps|packages, depth-1 otherwise", () => {
  assert.deepEqual(
    chooseAffectedPaths(["packages/foo/src/a.ts", "apps/web/x.ts", "src/lib/b.ts"]).sort(),
    ["apps/web", "packages/foo", "src"],
  );
});

test("sanitizePaths drops absolute, traversal, and metachar paths", () => {
  assert.deepEqual(sanitizePaths(["src/lib", "/etc/passwd", "../../x", "a b", "ok/path"]), ["src/lib", "ok/path"]);
});

test("last_mapped_commit round-trips through frontmatter", () => {
  const d = scratchDir("drift");
  mkdirSync(join(d, "codebase"), { recursive: true });
  const f = join(d, "codebase", "STRUCTURE.md");
  writeFileSync(f, "# Structure\n\nbody content\n");
  assert.equal(readMappedCommit(f), null, "no frontmatter yet");
  writeMappedCommit(f, "abc123", "2026-06-21");
  assert.equal(readMappedCommit(f), "abc123");
  // body preserved
  assert.match(readFileSync(f, "utf8"), /body content/);
});
