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

test("CR-1: $-sequences in a value are stored literally (no replace-string corruption)", () => {
  // $ is not a quote-trigger, so this stores UNQUOTED but LITERAL — the bug was replace-STRING $-interpretation.
  assert.match(setFrontmatterField(FM, "status", "a$1b$$c"), /status: a\$1b\$\$c/);
  // a value with a space IS quoted, and its $/backtick survive verbatim
  assert.match(setFrontmatterField(FM, "status", "x y$`z"), /status: "x y\$`z"/);
});

test("CR-2: a regex-special key/section neither throws nor duplicates", () => {
  assert.doesNotThrow(() => setFrontmatterField(FM, "a.b[", "v"));
  const once = appendUnderSection("# T\n", "Notes (x)", "hi");
  const twice = appendUnderSection(once, "Notes (x)", "ho");
  assert.equal((twice.match(/## Notes \(x\)/g) || []).length, 1, "no duplicate section for a parenthesized name");
});

test("MED-1: appendUnderSection APPENDS (newest-last), clean spacing", () => {
  const out = appendUnderSection("## Decisions\n\n- existing-1\n", "Decisions", "newest");
  assert.match(out, /- existing-1\n- newest/, "newest after existing");
  assert.ok(!/\n\n\n/.test(out), "no triple newline");
});

test("MED-2: setProgressFields preserves a nested child block", () => {
  const nested = "---\nprogress:\n  total_plans: 3\n  meta:\n    nested: 1\n  completed_plans: 1\n---\n";
  const out = setProgressFields(nested, { completed_plans: 9 });
  assert.match(out, /completed_plans: 9/);
  assert.match(out, /meta:\n {4}nested: 1/, "nested block preserved verbatim");
});

test("MED-4: a multiline value collapses to one YAML line", () => {
  const out = setFrontmatterField(FM, "status", "line1\nline2");
  assert.match(out, /status: "line1 line2"/);
  assert.ok(!/status: "line1\nline2"/.test(out), "no raw newline in scalar");
});

test("WR-01: empty progress block is FILLED, not duplicated", () => {
  const out = setProgressFields("---\nstatus: planning\nprogress:\n---\n", { total_plans: 5 });
  assert.equal((out.match(/progress:/g) || []).length, 1, "exactly one progress: key");
  assert.match(out, /progress:\n  total_plans: 5/);
});

test("WR-02: CRLF input is not a silent no-op", () => {
  const crlf = "---\r\nstatus: planning\r\nprogress:\r\n  completed_plans: 1\r\n---\r\n";
  const out = setProgressFields(crlf, { completed_plans: 7 });
  assert.match(out, /completed_plans: 7/, "CRLF update applied");
});

test("WR-03: progress as the LAST frontmatter key adds no stray blank line", () => {
  const out = setProgressFields("---\nstatus: planning\nprogress:\n  total_plans: 2\n---\n", { total_plans: 3 });
  assert.ok(!/\n\n---/.test(out), "no blank line before closing ---");
  assert.match(out, /total_plans: 3/);
});

test("WR-04: appendUnderSection does not append inside a code fence", () => {
  const withFence = "## Decisions\n\n- a\n\n```\n## not a heading\n```\n";
  const out = appendUnderSection(withFence, "Decisions", "b");
  // the new entry lands after the fence's closing ```, still within Decisions (no later real heading)
  assert.match(out, /```\n- b/, "appended after the fence, fence intact");
  assert.equal((out.match(/```/g) || []).length, 2, "both fence delimiters preserved");
});
