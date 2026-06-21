import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeGsdSection, GSD_BEGIN, GSD_END } from "../src/engage/agents-md.js";

test("BLOCKER #1: a FENCED example of the GSD markers is NOT treated as a managed block (no user-data loss)", () => {
  const userContent = [
    "# AGENTS.md",
    "",
    "## How GSD marks its block",
    "",
    "```",
    GSD_BEGIN,
    "IMPORTANT EXAMPLE LINE the user wrote",
    GSD_END,
    "```",
    "",
    "## My house rules",
    "- be terse",
  ].join("\n");
  const out = mergeGsdSection(userContent);
  assert.match(out, /IMPORTANT EXAMPLE LINE the user wrote/, "the fenced example content must survive");
  assert.match(out, /## My house rules/, "user content preserved");
  // and a real (non-fenced) managed block IS prepended exactly once
  const realBlocks = out.split(GSD_BEGIN).length - 1;
  assert.ok(realBlocks >= 1, "a fresh managed block is present");
});

test("idempotency #2: two managed blocks collapse to exactly ONE on merge", () => {
  const twoBlocks = `# AGENTS.md\n\n${GSD_BEGIN}\nold one\n${GSD_END}\n\n## user\n- x\n\n${GSD_BEGIN}\nold two\n${GSD_END}\n`;
  const out = mergeGsdSection(twoBlocks);
  assert.equal(out.split(GSD_BEGIN).length - 1, 1, "exactly one managed block after merge");
  assert.equal(out.split(GSD_END).length - 1, 1, "exactly one end marker");
  assert.match(out, /## user/, "user content kept");
  assert.doesNotMatch(out, /old one|old two/, "stale managed bodies removed");
});

test("re-merge is stable (running twice yields the same result)", () => {
  const once = mergeGsdSection("# AGENTS.md\n\n## rules\n- terse\n");
  const twice = mergeGsdSection(once);
  assert.equal(twice.split(GSD_BEGIN).length - 1, 1, "still exactly one block after a second merge");
  assert.match(twice, /## rules/);
});
