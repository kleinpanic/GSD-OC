import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENTS, AGENT_IDS, resolveAgent } from "../src/agents/index.js";

const RAW_CC_TOKENS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "Agent",
  "Task",
  "WebSearch",
  "WebFetch",
  "AskUserQuestion",
];

test("33/33 inventory: roster ports exactly the live gsd-*.md agents (AGT-01, Pitfall 4)", () => {
  assert.equal(AGENT_IDS.length, 33, "expected 33 ported agents");
  assert.equal(new Set(AGENT_IDS).size, 33, "agent ids must be unique");
  for (const id of AGENT_IDS) assert.ok(id.startsWith("gsd-"), `id ${id} should be gsd-*`);
});

test("every record has non-empty prompt and tools.allow.length > 0 (AGT-01)", () => {
  for (const id of AGENT_IDS) {
    const def = AGENTS[id];
    assert.ok(def.prompt.trim().length > 0, `${id}: empty prompt`);
    assert.ok(def.tools.allow.length > 0, `${id}: empty allowlist`);
    assert.ok(["low", "high", "xhigh"].includes(def.thinking), `${id}: bad thinking tier`);
  }
});

test("no raw CC tool name survives in any tools.allow/deny (AGT-03)", () => {
  for (const id of AGENT_IDS) {
    const def = AGENTS[id];
    const set = [...def.tools.allow, ...(def.tools.deny ?? [])];
    for (const tok of set) {
      assert.ok(!RAW_CC_TOKENS.includes(tok), `${id}: raw CC token "${tok}" survived mapping`);
      assert.ok(!tok.startsWith("mcp__"), `${id}: mcp__ token "${tok}" survived`);
    }
  }
});

test("both block-list agents resolve with non-empty allowlists (Pitfall 2)", () => {
  for (const id of ["gsd-security-auditor", "gsd-nyquist-auditor"]) {
    const def = resolveAgent(id);
    assert.ok(def.tools.allow.length > 0, `${id}: block-list agent has empty allowlist`);
    // block-list source lists Read/Write/Edit/Bash/Glob/Grep -> mapped ids
    assert.ok(def.tools.allow.includes("read"), `${id}: missing mapped read`);
    assert.ok(def.tools.allow.includes("exec"), `${id}: missing mapped exec (Bash)`);
  }
});

test("Agent tool maps to sessions_spawn (AGT-03)", () => {
  // gsd-debug-session-manager lists the CC `Agent` tool.
  const def = resolveAgent("gsd-debug-session-manager");
  assert.ok(def.tools.allow.includes("sessions_spawn"), "Agent should map to sessions_spawn");
});

test("resolveAgent returns a record for a known id and throws for unknown", () => {
  const def = resolveAgent("gsd-executor");
  assert.equal(def.id, "gsd-executor");
  assert.ok(def.prompt.length > 0);
  assert.throws(() => resolveAgent("nope"), /unknown agent id/);
});
