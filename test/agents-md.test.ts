import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gsdAgentsSection,
  mergeGsdSection,
  applyGsdAgentsMd,
  GSD_BEGIN,
  GSD_END,
} from "../src/engage/agents-md.js";

test("gsdAgentsSection carries the meta-prompt + tool guidance between markers", () => {
  const s = gsdAgentsSection();
  assert.ok(s.startsWith(GSD_BEGIN) && s.trimEnd().endsWith(GSD_END));
  assert.ok(s.includes("[GSD auto-engaged]"));
  assert.ok(s.includes("gsd_workflow"));
});

test("mergeGsdSection creates AGENTS.md when none exists", () => {
  const out = mergeGsdSection(null);
  assert.ok(out.includes("# AGENTS.md"));
  assert.ok(out.includes(GSD_BEGIN) && out.includes(GSD_END));
});

test("mergeGsdSection prepends the block (leads competing persona) without clobbering content", () => {
  const existing = "# AGENTS.md\n\n## House rules\n- be terse\n";
  const out = mergeGsdSection(existing);
  assert.ok(out.includes("## House rules"), "existing content preserved");
  assert.ok(out.includes(GSD_BEGIN));
  // Salience: the GSD block must lead the competing persona (appear BEFORE "## House rules").
  assert.ok(
    out.indexOf(GSD_BEGIN) < out.indexOf("## House rules"),
    "GSD block leads the existing persona",
  );
  // The leading `# AGENTS.md` title stays at the very top.
  assert.ok(out.startsWith("# AGENTS.md"), "title preserved at top");
});

test("mergeGsdSection prepends the block at the very top when there is no title line", () => {
  const existing = "## House rules\n- be terse\n";
  const out = mergeGsdSection(existing);
  assert.ok(out.startsWith(GSD_BEGIN), "block leads the file when no title");
  assert.ok(out.indexOf(GSD_BEGIN) < out.indexOf("## House rules"));
});

test("mergeGsdSection is idempotent — re-merge refreshes the block in place, no duplication", () => {
  const once = mergeGsdSection("# AGENTS.md\n\n## House rules\n");
  const twice = mergeGsdSection(once);
  const count = (twice.match(new RegExp(GSD_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [])
    .length;
  assert.equal(count, 1, "exactly one managed block after re-merge");
  assert.ok(twice.includes("## House rules"));
});

test("corrupt block (begin, no end) rewrites to exactly ONE managed block (CR-02)", () => {
  const beginRe = new RegExp(GSD_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  // A truncated managed region: GSD_BEGIN present, GSD_END missing.
  const corrupt = `# AGENTS.md\n\n${GSD_BEGIN}\n## GSD — partial\nmore lines but no end marker\n`;
  const out = mergeGsdSection(corrupt);
  assert.equal((out.match(beginRe) || []).length, 1, "exactly one gsd-oc:begin after repair");
  assert.ok(out.includes(GSD_END), "repaired block now has an end marker");
  // Idempotency must hold: a second merge sees a well-formed pair and refreshes in place.
  const twice = mergeGsdSection(out);
  assert.equal((twice.match(beginRe) || []).length, 1, "still exactly one block after re-merge");
});

test("mergeGsdSection idempotency: merge(merge(x)) === merge(x)", () => {
  const x = "# AGENTS.md\n\n## House rules\n- be terse\n";
  const once = mergeGsdSection(x);
  const twice = mergeGsdSection(once);
  assert.equal(twice, once, "re-merging an already-merged file is a fixed point");
});

test("existing '# AGENTS.md' title → GSD block inserted AFTER the title", () => {
  const out = mergeGsdSection("# AGENTS.md\n\n## House\n");
  assert.ok(out.startsWith("# AGENTS.md"), "title remains first");
  assert.ok(out.indexOf(GSD_BEGIN) > out.indexOf("# AGENTS.md"), "GSD block sits after the title");
});

test("applyGsdAgentsMd writes the file and is idempotent on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsd-agentsmd-"));
  try {
    writeFileSync(join(dir, "AGENTS.md"), "# AGENTS.md\n\n## Existing\n- keep me\n");
    const r1 = await applyGsdAgentsMd(dir);
    assert.equal(r1.changed, true);
    const body = readFileSync(r1.path, "utf8");
    assert.ok(body.includes("## Existing") && body.includes(GSD_BEGIN));
    const r2 = await applyGsdAgentsMd(dir);
    assert.equal(r2.changed, false, "second apply is a no-op (already merged)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("M-1: a corrupt GSD block (BEGIN, no END) preserves user content below it", () => {
  const corrupt = "# AGENTS.md\n\n<!-- gsd-oc:begin (managed — do not edit between markers) -->\nold block\n\n## My persona\nCritical user content.\n";
  const out = mergeGsdSection(corrupt);
  assert.ok(out.includes("My persona"), "user persona below a corrupt block is preserved");
  assert.ok(out.includes("Critical user content."), "user content not deleted");
});
