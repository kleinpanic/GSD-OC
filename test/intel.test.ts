import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { isIntelEnabled, intelQuery, intelStatus, intelExtractExports, intelDiff, intelSnapshot, intelValidate, intelPatchMeta, INTEL_FILES } from "../src/engine/intel.js";
import { scratchDir, cleanupAllScratch } from "./helpers/scratch.js";

after(cleanupAllScratch);

function enabledIntel(): string {
  const d = scratchDir("intel");
  writeFileSync(join(d, "config.json"), JSON.stringify({ intel: { enabled: true } }));
  mkdirSync(join(d, "intel"), { recursive: true });
  return d;
}

test("isIntelEnabled gates on config.intel.enabled === true", () => {
  const d = scratchDir("intel-gate");
  assert.equal(isIntelEnabled(d), false);
  writeFileSync(join(d, "config.json"), JSON.stringify({ intel: { enabled: true } }));
  assert.equal(isIntelEnabled(d), true);
});

test("intelQuery is disabled when off; searches keys + nested values when on", () => {
  const off = scratchDir("intel-off");
  assert.equal((intelQuery(off, "x") as { disabled?: boolean }).disabled, true);

  const d = enabledIntel();
  writeFileSync(
    join(d, "intel", INTEL_FILES.files),
    JSON.stringify({ _meta: { updated_at: "2026-06-21" }, entries: { "src/auth.ts": { role: "authentication entry point" } } }),
  );
  const hitKey = intelQuery(d, "auth.ts") as { total: number };
  assert.equal(hitKey.total, 1, "key match");
  const hitVal = intelQuery(d, "authentication") as { total: number; matches: { source: string }[] };
  assert.equal(hitVal.total, 1, "nested value match");
  assert.equal(hitVal.matches[0].source, INTEL_FILES.files);
  assert.equal((intelQuery(d, "nonexistent") as { total: number }).total, 0);
});

test("intelStatus reports per-file existence + staleness via injected clock", () => {
  const d = enabledIntel();
  writeFileSync(join(d, "intel", INTEL_FILES.stack), JSON.stringify({ _meta: { updated_at: "2026-06-21T00:00:00Z" } }));
  const at = Date.parse("2026-06-21T01:00:00Z"); // 1h later → fresh
  const s = intelStatus(d, { now: () => at }) as { files: Record<string, { exists: boolean; stale: boolean }>; overall_stale: boolean };
  assert.equal(s.files[INTEL_FILES.stack].exists, true);
  assert.equal(s.files[INTEL_FILES.stack].stale, false);
  assert.equal(s.files[INTEL_FILES.files].exists, false, "missing file → exists:false");
  assert.equal(s.overall_stale, true, "a missing file makes overall stale");
});

test("intelExtractExports handles CJS module.exports, exports.X, ESM, and mixed", () => {
  const d = scratchDir("intel-exp");
  const cjs = join(d, "a.cjs");
  writeFileSync(cjs, "const x=1;\nmodule.exports = {\n  foo,\n  bar: baz,\n  // comment\n  qux\n};\n");
  const rc = intelExtractExports(cjs);
  assert.equal(rc.method, "module.exports");
  assert.deepEqual(rc.exports.sort(), ["bar", "foo", "qux"]);

  const esm = join(d, "b.ts");
  writeFileSync(esm, "export function go(){}\nexport const N = 1;\nexport class C {}\nexport { go as renamed, N };\n");
  const re = intelExtractExports(esm);
  assert.equal(re.method, "esm");
  assert.ok(re.exports.includes("go") && re.exports.includes("N") && re.exports.includes("C"));

  const mixed = join(d, "c.js");
  writeFileSync(mixed, "exports.legacy = 1;\nexport const modern = 2;\n");
  assert.equal(intelExtractExports(mixed).method, "mixed");

  assert.deepEqual(intelExtractExports(join(d, "nope.js")), { file: join(d, "nope.js"), exports: [], method: "none" });
});

test("intelSnapshot → intelDiff detects changed/added/removed via content hashes", () => {
  const d = enabledIntel();
  const stack = join(d, "intel", INTEL_FILES.stack);
  writeFileSync(stack, JSON.stringify({ _meta: {}, entries: { node: "22" } }));
  // no baseline yet
  assert.equal((intelDiff(d) as { no_baseline?: boolean }).no_baseline, true);
  // snapshot, then mutate stack + add a new file
  const snap = intelSnapshot(d, { now: () => Date.now() }) as { files: number };
  assert.equal(snap.files, 1);
  writeFileSync(stack, JSON.stringify({ _meta: {}, entries: { node: "24" } })); // changed
  writeFileSync(join(d, "intel", INTEL_FILES.deps), JSON.stringify({ entries: {} })); // added
  const diff = intelDiff(d) as { changed: string[]; added: string[]; removed: string[] };
  assert.deepEqual(diff.changed, [INTEL_FILES.stack]);
  assert.deepEqual(diff.added, [INTEL_FILES.deps]);
});

test("intelPatchMeta bumps updated_at + version; errors on missing/invalid", () => {
  const d = enabledIntel();
  const f = join(d, "intel", INTEL_FILES.apis);
  writeFileSync(f, JSON.stringify({ entries: {} }));
  const r = intelPatchMeta(f, { now: () => Date.parse("2026-06-21T00:00:00Z") });
  assert.equal(r.patched, true);
  const data = JSON.parse(readFileSync(f, "utf8"));
  assert.equal(data._meta.version, 1);
  assert.equal(data._meta.updated_at, "2026-06-21T00:00:00.000Z");
  // second patch bumps version
  intelPatchMeta(f, { now: () => Date.now() });
  assert.equal(JSON.parse(readFileSync(f, "utf8"))._meta.version, 2);
  assert.equal(intelPatchMeta(join(d, "missing.json")).patched, false);
});

test("intelValidate flags missing files, stale meta, and space-y exports", () => {
  const d = enabledIntel();
  // files.json with a description-looking export (space) + fresh meta
  writeFileSync(
    join(d, "intel", INTEL_FILES.files),
    JSON.stringify({ _meta: { updated_at: "2026-06-21T00:00:00Z" }, entries: { "x.ts": { exports: ["good", "looks like prose"] } } }),
  );
  const v = intelValidate(d, { now: () => Date.parse("2026-06-21T01:00:00Z") }) as { valid: boolean; errors: string[]; warnings: string[] };
  // the other 4 intel files are missing → errors → not valid
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes("does not exist")));
  assert.ok(v.warnings.some((w) => w.includes("looks like a description")));
});
