/**
 * Phase-artifact templates (native port of GSD's context/plan/summary/verification templates). The subagents
 * (planner/executor/verifier) author these, but their BYTE STRUCTURE is load-bearing: route() keys on CONTEXT.md
 * presence + PLAN.md presence, and verify() keys on `#PLAN == #SUMMARY` + a `**Status:** PASSED` verdict line.
 * This module emits each artifact in the exact shape those engines parse, so a scaffolded phase round-trips
 * through route()/verify() by construction (not by hoping the agent got the heading right).
 *
 * File naming (the convention route()/verify() scan): phases/NN-slug/{NN-CONTEXT, NN-MM-PLAN, NN-MM-SUMMARY,
 * NN-VERIFICATION}.md where NN=phase, MM=plan index.
 */

function pad(n: number | string): string {
  return String(n).padStart(2, "0");
}

/** NN-CONTEXT.md — the discuss-phase output route() looks for (Route 2: no CONTEXT/RESEARCH → discuss). */
export function contextTemplate(phaseNum: number | string, phaseName: string, decisions: string[] = []): string {
  const body = decisions.length ? decisions.map((d) => `- ${d}`).join("\n") : "- [decisions emerge from the phase discussion]";
  return (
    `# Phase ${phaseNum} Context — ${phaseName}\n\n` +
    `**Phase:** ${phaseNum}\n\n` +
    `## Decisions (locked)\n\n${body}\n\n` +
    `## Open Questions\n\n- [questions for research/planning]\n`
  );
}

/** NN-MM-PLAN.md — the plan-phase output route() requires before execute (Route 3: no PLAN → plan). */
export function planTemplate(
  phaseNum: number | string,
  planIdx: number | string,
  opts: { goal?: string; tasks?: string[]; requirements?: string[] } = {},
): string {
  const tasks = (opts.tasks && opts.tasks.length ? opts.tasks : ["[task]"]).map((t, i) => `${i + 1}. ${t}`).join("\n");
  const reqs = (opts.requirements ?? []).map((r) => `- ${r}`).join("\n");
  return (
    `---\nphase: ${pad(phaseNum)}\nplan: ${pad(planIdx)}\n---\n\n` +
    `# Phase ${phaseNum} — Plan ${planIdx}\n\n` +
    `**Goal:** ${opts.goal ?? "[plan goal]"}\n\n` +
    (reqs ? `**Requirements:**\n${reqs}\n\n` : "") +
    `## Tasks\n\n${tasks}\n\n` +
    `## Verification\n\n- [how to confirm this plan achieved its goal]\n`
  );
}

/** NN-MM-SUMMARY.md — the execute-phase output; verify() pairs one SUMMARY per PLAN. Carries the GSD frontmatter. */
export function summaryTemplate(
  phaseNum: number | string,
  planIdx: number | string,
  opts: { phaseName?: string; provides?: string[]; commits?: string[] } = {},
): string {
  const provides = (opts.provides ?? ["[what this plan delivered]"]).map((p) => `  - ${p}`).join("\n");
  const commits = (opts.commits ?? []).map((c) => `- ${c}`).join("\n");
  return (
    `---\nphase: ${pad(phaseNum)}-${(opts.phaseName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}\n` +
    `plan: ${pad(planIdx)}\nprovides:\n${provides}\n---\n\n` +
    `# Phase ${phaseNum} — Plan ${planIdx} Summary\n\n` +
    `## What was built\n\n${provides.replace(/^ {2}/gm, "")}\n\n` +
    (commits ? `## Commits\n\n${commits}\n` : "")
  );
}

/** NN-VERIFICATION.md — the verify-work output. The `**Status:** PASSED` line is what verify()/route() key on. */
export function verificationTemplate(
  phaseNum: number | string,
  status: "PASSED" | "FAILED" | "GAPS_FOUND",
  opts: { phaseName?: string; score?: string; findings?: string[] } = {},
): string {
  const findings = (opts.findings ?? []).map((f) => `- ${f}`).join("\n");
  return (
    `---\nphase: ${pad(phaseNum)}-${(opts.phaseName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}\n` +
    `status: ${status.toLowerCase()}\n---\n\n` +
    `# Phase ${phaseNum} Verification\n\n` +
    `**Status:** ${status}\n` +
    (opts.score ? `**Score:** ${opts.score}\n` : "") +
    (findings ? `\n## Findings\n\n${findings}\n` : "")
  );
}

/** Canonical filenames for a phase's artifacts (the names route()/verify() scan for). */
export function artifactName(phaseNum: number | string, kind: "context" | "verification"): string;
export function artifactName(phaseNum: number | string, kind: "plan" | "summary", planIdx: number | string): string;
export function artifactName(phaseNum: number | string, kind: string, planIdx?: number | string): string {
  switch (kind) {
    case "context": return `${pad(phaseNum)}-CONTEXT.md`;
    case "verification": return `${pad(phaseNum)}-VERIFICATION.md`;
    case "plan": return `${pad(phaseNum)}-${pad(planIdx!)}-PLAN.md`;
    case "summary": return `${pad(phaseNum)}-${pad(planIdx!)}-SUMMARY.md`;
    default: throw new Error(`unknown artifact kind: ${kind}`);
  }
}
