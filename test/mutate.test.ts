import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setFrontmatterField, setProgressFields, appendUnderSection,
  setStatus, recordProgress, addDecision, addBlocker,
} from "../src/engine/mutate.js";

const FM = "---\nstatus: planning\nprogress:\n  total_plans: 4\n  completed_plans: 1\n  percent: 25\n---\n\n# Project State\n";

// ── pure transforms ──
test("setFrontmatterField replaces an existing scalar + adds a new one", () => {
  assert.match(setFrontmatterField(FM, "status", "executing"), /status: executing/);
  assert.match(setFrontmatterField(FM, "milestone", "v1.6"), /milestone: v1\.6/);
  // value needing quotes
  assert.match(setFrontmatterField(FM, "note", "a b"), /note: "a b"/);
});

test("setProgressFields merges child fields + leaves others", () => {
  const out = setProgressFields(FM, { completed_plans: 3 });
  assert.match(out, /completed_plans: 3/);
  assert.match(out, /total_plans: 4/); // untouched
});

test("appendUnderSection creates the section if absent, appends if present", () => {
  const created = appendUnderSection("# State\n", "Decisions", "chose X");
  assert.match(created, /## Decisions\n\n- chose X/);
  const appended = appendUnderSection(created, "Decisions", "chose Y");
  assert.equal((appended.match(/## Decisions/g) || []).length, 1, "no duplicate section");
  assert.match(appended, /chose Y/);
});

// ── lock-protected mutation verbs (atomic, on disk) ──
function tmpState(): { dir: string; read: () => string } {
  const dir = mkdtempSync(join(tmpdir(), "gsd-mut-"));
  writeFileSync(join(dir, "STATE.md"), FM);
  return { dir, read: () => readFileSync(join(dir, "STATE.md"), "utf8") };
}

test("setStatus writes status + stamps last_updated/last_activity", () => {
  const { dir, read } = tmpState();
  try {
    setStatus(dir, "executing");
    const s = read();
    assert.match(s, /status: executing/);
    assert.match(s, /last_updated: "/);
    assert.match(s, /last_activity: \d{4}-\d{2}-\d{2}/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recordProgress updates counts + recomputes percent (the live state advance)", () => {
  const { dir, read } = tmpState();
  try {
    recordProgress(dir, { total_plans: 4, completed_plans: 3 });
    const s = read();
    assert.match(s, /completed_plans: 3/);
    assert.match(s, /percent: 75/); // 3/4
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("addDecision + addBlocker append dated entries", () => {
  const { dir, read } = tmpState();
  try {
    addDecision(dir, "use spark embeddings");
    addBlocker(dir, "gateway runtime gap");
    const s = read();
    assert.match(s, /## Decisions\n\n- \d{4}-\d{2}-\d{2} — use spark embeddings/);
    assert.match(s, /## Blockers\n\n- \d{4}-\d{2}-\d{2} — gateway runtime gap/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
