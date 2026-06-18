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

test("mergeGsdSection appends to existing content without clobbering it", () => {
  const existing = "# AGENTS.md\n\n## House rules\n- be terse\n";
  const out = mergeGsdSection(existing);
  assert.ok(out.includes("## House rules"), "existing content preserved");
  assert.ok(out.includes(GSD_BEGIN));
});

test("mergeGsdSection is idempotent — re-merge refreshes the block in place, no duplication", () => {
  const once = mergeGsdSection("# AGENTS.md\n\n## House rules\n");
  const twice = mergeGsdSection(once);
  const count = (twice.match(new RegExp(GSD_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [])
    .length;
  assert.equal(count, 1, "exactly one managed block after re-merge");
  assert.ok(twice.includes("## House rules"));
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
