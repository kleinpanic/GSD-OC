import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAgentOptional } from "../src/agents/index.js";
import { loadCorpus } from "../src/retrieval/corpus.js";

const agents = [...new Set(loadCorpus().docs.filter((d) => d.id.startsWith("agent:")).map((d) => d.id.replace("agent:", "")))].sort();

// the user's fleets — every roster agent must belong to one, and each fleet must be populated
const FLEETS: Record<string, string[]> = {
  "research/planning": ["gsd-project-researcher", "gsd-phase-researcher", "gsd-advisor-researcher", "gsd-domain-researcher", "gsd-research-synthesizer", "gsd-roadmapper", "gsd-planner", "gsd-plan-checker", "gsd-pattern-mapper", "gsd-assumptions-analyzer"],
  "execution/verification": ["gsd-executor", "gsd-verifier", "gsd-integration-checker", "gsd-nyquist-auditor"],
  "review/security/debug": ["gsd-code-reviewer", "gsd-code-fixer", "gsd-security-auditor", "gsd-debugger", "gsd-debug-session-manager"],
  "docs/eval": ["gsd-doc-writer", "gsd-doc-verifier", "gsd-doc-classifier", "gsd-doc-synthesizer", "gsd-eval-planner", "gsd-eval-auditor"],
  "ui/codebase": ["gsd-ui-researcher", "gsd-ui-checker", "gsd-ui-auditor", "gsd-codebase-mapper"],
  "ai/intel": ["gsd-ai-researcher", "gsd-framework-selector", "gsd-intel-updater", "gsd-user-profiler"],
};

test("FLEET: all 33 roster subagents are present + resolve", () => {
  assert.equal(agents.length, 33, `expected the 33-agent fleet, got ${agents.length}`);
  const unresolved = agents.filter((a) => !resolveAgentOptional(a));
  assert.deepEqual(unresolved, [], `every roster agent must resolve; unresolved: ${unresolved.join(", ")}`);
});

test("FLEET: every agent belongs to exactly one named fleet (full coverage)", () => {
  const assigned = new Set(Object.values(FLEETS).flat());
  const orphans = agents.filter((a) => !assigned.has(a));
  assert.deepEqual(orphans, [], `agents not assigned to any fleet: ${orphans.join(", ")}`);
  // and every fleet entry is a real roster agent (no typos)
  const roster = new Set(agents);
  for (const [fleet, members] of Object.entries(FLEETS)) {
    assert.ok(members.length > 0, `${fleet} is empty`);
    const ghosts = members.filter((m) => !roster.has(m));
    assert.deepEqual(ghosts, [], `${fleet} lists non-roster agents: ${ghosts.join(", ")}`);
    for (const m of members) assert.ok(resolveAgentOptional(m), `${fleet} → ${m} does not resolve`);
  }
});
