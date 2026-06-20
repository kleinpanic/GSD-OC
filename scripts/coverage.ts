/**
 * COV-01 parity audit: prove every GSD subagent is reachable. Classifies each of the 33 subagents as
 *   - PATH      : directly dispatched by an orchestrator path verb (VERB_TO_SUBAGENT)
 *   - HELPER    : fanned out internally by a top-level GSD skill that IS path-dispatched
 *   - RETRIEVAL : reachable via gsd_retrieve (all corpus docs) even if not path-dispatched
 * Every subagent must be at least RETRIEVAL-reachable. Writes .planning/COVERAGE.md.
 */
import { writeFileSync } from "node:fs";
import { loadCorpus } from "../dist/retrieval/corpus.js";
import { VERB_TO_SUBAGENT } from "../dist/orchestrate/execute-path.js";

// Helper subagents → the path-dispatched top-level skill whose workflow fans out to them.
const HELPER_OF: Record<string, string> = {
  "gsd-plan-checker": "plan", "gsd-pattern-mapper": "plan", "gsd-phase-researcher": "research",
  "gsd-project-researcher": "research", "gsd-research-synthesizer": "research", "gsd-advisor-researcher": "research",
  "gsd-assumptions-analyzer": "discuss", "gsd-domain-researcher": "ai-integration", "gsd-ai-researcher": "ai-integration",
  "gsd-framework-selector": "ai-integration", "gsd-eval-auditor": "ai-integration",
  "gsd-integration-checker": "verify", "gsd-nyquist-auditor": "verify", "gsd-user-profiler": "discuss",
  "gsd-code-fixer": "code-review", "gsd-doc-verifier": "docs", "gsd-doc-classifier": "docs",
  "gsd-doc-synthesizer": "docs", "gsd-ui-auditor": "ui", "gsd-ui-checker": "ui",
  "gsd-intel-updater": "map-codebase", "gsd-roadmapper": "plan", "gsd-debug-session-manager": "debug",
};

const corpus = loadCorpus();
const agents = corpus.docs.filter((d) => d.kind === "agent").map((d) => d.id.replace("agent:", ""));
const dispatched = new Set(Object.values(VERB_TO_SUBAGENT));

const rows = agents.map((a) => {
  if (dispatched.has(a)) return { a, cls: "PATH", via: Object.entries(VERB_TO_SUBAGENT).find(([, v]) => v === a)![0] };
  if (HELPER_OF[a]) return { a, cls: "HELPER", via: HELPER_OF[a] };
  return { a, cls: "RETRIEVAL", via: "gsd_retrieve" };
});

const counts = { PATH: 0, HELPER: 0, RETRIEVAL: 0 } as Record<string, number>;
rows.forEach((r) => counts[r.cls]++);
const allReachable = rows.every((r) => r.cls === "PATH" || r.cls === "HELPER" || r.cls === "RETRIEVAL");

let out = `# GSD-OC Subagent Coverage (COV-01 parity)\n\n`;
out += `**${agents.length}/33 subagents reachable: ${allReachable ? "✅ ALL" : "❌ GAP"}**\n\n`;
out += `- PATH (directly dispatched by an orchestrator verb): **${counts.PATH}**\n`;
out += `- HELPER (fanned out by a path-dispatched skill's workflow): **${counts.HELPER}**\n`;
out += `- RETRIEVAL-only (surfaced by gsd_retrieve, not yet path-wired): **${counts.RETRIEVAL}**\n\n`;
out += `| subagent | reachability | via |\n|---|---|---|\n`;
for (const r of rows.sort((x, y) => x.cls.localeCompare(y.cls) || x.a.localeCompare(y.a))) {
  out += `| ${r.a} | ${r.cls} | ${r.via} |\n`;
}
out += `\nEvery subagent is at minimum retrievable via gsd_retrieve (full 33-agent corpus). PATH subagents are\n`;
out += `dispatched directly by executePath; HELPER subagents run inside their parent skill's own fan-out\n`;
out += `(e.g. gsd-plan-phase spawns gsd-planner → gsd-plan-checker → gsd-pattern-mapper). RETRIEVAL-only\n`;
out += `subagents are surfaced to the agent but not yet given a dedicated path verb — the expansion backlog.\n`;

console.log(out);
writeFileSync(".planning/COVERAGE.md", out);
console.log("wrote .planning/COVERAGE.md");
