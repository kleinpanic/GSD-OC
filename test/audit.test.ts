import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanUat, auditOpen } from "../src/engine/audit.js";

function setup(): string {
  const d = mkdtempSync(join(tmpdir(), "gsd-au2-"));
  const p = join(d, ".planning");
  mkdirSync(join(p, "phases", "01-foo"), { recursive: true });
  mkdirSync(join(p, "phases", "02-bar"), { recursive: true });
  writeFileSync(join(p, "ROADMAP.md"), "### Phase 1: Foo\n**Requirements:** RET-01\n### Phase 2: Bar\n**Requirements:** RET-02\n");
  writeFileSync(join(p, "REQUIREMENTS.md"), "- [ ] RET-01\n- [ ] RET-02\n- [ ] AUTH-09\n");
  writeFileSync(join(p, "STATE.md"), "---\nstatus: executing\n---\n# State\n\n## Blockers\n- spark endpoint down\n\n## Progress\n");
  // phase 1 passed
  writeFileSync(join(p, "phases", "01-foo", "01-01-PLAN.md"), "#");
  writeFileSync(join(p, "phases", "01-foo", "01-01-SUMMARY.md"), "#");
  writeFileSync(join(p, "phases", "01-foo", "1-VERIFICATION.md"), "**Status:** PASSED\n");
  // phase 2 failed
  writeFileSync(join(p, "phases", "02-bar", "02-01-PLAN.md"), "#");
  writeFileSync(join(p, "phases", "02-bar", "02-01-SUMMARY.md"), "#");
  writeFileSync(join(p, "phases", "02-bar", "2-VERIFICATION.md"), "**Status:** FAILED\n");
  return p;
}

test("scanUat: per-phase verification verdicts", () => {
  const p = setup();
  try {
    const u = scanUat(p);
    assert.deepEqual(u.map((x) => `${x.phase}:${x.verification}`), ["1:passed", "2:failed"]);
    assert.equal(u[0].name, "Foo");
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});

test("auditOpen: aggregates blockers + failed verification + uncovered reqs", () => {
  const p = setup();
  try {
    const a = auditOpen(p);
    assert.ok(!a.clean);
    assert.ok(a.open.some((o) => o.type === "blocker" && /spark/.test(o.detail)));
    assert.ok(a.open.some((o) => o.type === "verification-failed" && /phase 2/.test(o.detail)));
    assert.ok(a.open.some((o) => o.type === "uncovered-requirement" && o.detail === "AUTH-09"));
  } finally { rmSync(join(p, ".."), { recursive: true, force: true }); }
});
