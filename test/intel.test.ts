import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isIntelEnabled, intelQuery, intelStatus, intelExtractExports, INTEL_FILES } from "../src/engine/intel.js";
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
