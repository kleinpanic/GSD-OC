import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldPlanning } from "../src/engine/scaffold.js";
import { route } from "../src/engine/route.js";
import { validateArtifacts } from "../src/engine/verify.js";

test("scaffoldPlanning writes a VALID, route()-drivable .planning (the write-guarantee)", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-init-"));
  const p = join(d, "myproj", ".planning"); mkdirSync(p, { recursive: true });
  try {
    const r = scaffoldPlanning(p, { projectName: "MyProj", description: "do the thing" });
    assert.ok(r.created);
    for (const f of ["config.json", "STATE.md", "ROADMAP.md", "REQUIREMENTS.md", "PROJECT.md"]) assert.ok(existsSync(join(p, f)), f);
    // the scaffold is VALID by its own validator AND route() can drive it
    assert.ok(r.validation.ok, JSON.stringify(r.validation.defects));
    assert.ok(validateArtifacts(p).ok);
    assert.equal(route(p).phase, "1", "route() picks up the scaffolded phase 1");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("scaffoldPlanning is idempotent (never clobbers an initialized project)", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-init-"));
  const p = join(d, ".planning"); mkdirSync(p, { recursive: true });
  try {
    assert.ok(scaffoldPlanning(p).created);
    assert.equal(scaffoldPlanning(p).created, false, "second call is a no-op");
  } finally { rmSync(d, { recursive: true, force: true }); }
});
