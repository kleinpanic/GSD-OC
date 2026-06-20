/**
 * Numeric orchestration score (per .planning/SCORING-DESIGN.md). Runs gsd_retrieve + selectPath over a
 * 20-intent labeled set and computes a 0-100 composite:
 *   SCORE(no-G) = 100·(0.294·R + 0.471·P + 0.235·S)
 *   R = 0.35·recall@5 + 0.25·recall@10 + 0.25·MRR + 0.15·longtail@10   (retrieval)
 *   P = mean( 0.60·stageF1 + 0.25·backboneOrder + 0.15·gateFlags )     (path correctness)
 *   S = mean( precision@8 )                                            (skill relevance)
 * Run (spark over WG): SPARK_EMBEDDINGS_BASE_URL=http://10.0.0.1:18091/v1 node --experimental-strip-types scripts/score.ts
 */
import { writeFileSync } from "node:fs";
import { retrieve } from "../dist/retrieval/retrieve.js";
import { selectPath } from "../dist/orchestrate/select-path.js";

const BACKBONE = ["discuss", "map-codebase", "plan", "execute", "code-review", "verify", "ship"];
const LONGTAIL = ["spike", "ui", "ai-integration", "debug", "secure", "graphify"];

interface Task { intent: string; lt: string[]; gates: string[]; rx: RegExp; }
const TASKS: Task[] = [
  { intent: "the build is flaky and CI fails intermittently", lt: ["debug"], gates: [], rx: /debug|debugger|codebase-mapper/ },
  { intent: "the tests keep failing randomly", lt: ["debug"], gates: [], rx: /debug|debugger/ },
  { intent: "the deployment broke and I can't reproduce it", lt: ["debug"], gates: [], rx: /debug|debugger/ },
  { intent: "review my code for security vulnerabilities", lt: ["secure"], gates: [], rx: /secure|security|code-review|code-reviewer/ },
  { intent: "audit the threat model and mitigations", lt: ["secure"], gates: [], rx: /secure|security|security-auditor/ },
  { intent: "spike a risky technical approach quickly", lt: ["spike"], gates: [], rx: /spike/ },
  { intent: "sketch a throwaway UI mockup", lt: ["ui"], gates: ["ui"], rx: /ui-|sketch|frontend/ },
  { intent: "build the frontend dashboard with React components", lt: ["ui"], gates: ["ui"], rx: /ui-|ui-phase|sketch|frontend/ },
  { intent: "evaluate my AI agent's output quality", lt: ["ai-integration"], gates: ["ai-integration"], rx: /eval|ai-integration|ai-spec|domain-research|framework-select|revision-loop/ },
  { intent: "integrate an LLM and design its eval strategy", lt: ["ai-integration"], gates: ["ai-integration"], rx: /eval|ai-integration|ai-spec|framework-select/ },
  { intent: "build a knowledge graph of the project", lt: ["graphify"], gates: [], rx: /graphify|knowledge-graph/ },
  { intent: "plan the next phase of work", lt: [], gates: [], rx: /plan-phase|plan/ },
  { intent: "map the codebase architecture", lt: [], gates: [], rx: /map-codebase|codebase-mapper/ },
  { intent: "verify the phase delivered what it promised", lt: [], gates: [], rx: /verify|verifier|verify-work/ },
  { intent: "discuss the requirements before planning", lt: [], gates: [], rx: /discuss|discuss-phase/ },
  { intent: "execute the planned phase", lt: [], gates: [], rx: /execute|executor|execute-phase/ },
  { intent: "ship the milestone and open a PR", lt: [], gates: [], rx: /ship/ },
  { intent: "write documentation for the project", lt: [], gates: [], rx: /doc-writer|docs|documentation/ },
  { intent: "build a secure frontend login form", lt: ["ui", "secure"], gates: ["ui"], rx: /ui-|frontend|sketch|secure|security/ },
  { intent: "spike an AI feature then build the UI for it", lt: ["spike", "ai-integration", "ui"], gates: ["ui", "ai-integration"], rx: /spike|eval|ai-integration|ai-spec|ui-|frontend/ },
];

function f1(E: Set<string>, A: Set<string>): number {
  if (E.size === 0 && A.size === 0) return 1;
  const inter = [...A].filter((x) => E.has(x)).length;
  const prec = A.size ? inter / A.size : E.size === 0 ? 1 : 0;
  const rec = E.size ? inter / E.size : 1;
  return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
}

const rows: { intent: string; rank: number; s: number; stage: number; order: number; gate: number; p: number }[] = [];
let r5 = 0, r10 = 0, mrr = 0, ltN = 0, lt10 = 0, sSum = 0;

for (const t of TASKS) {
  const res = await retrieve(t.intent, { topK: 10 });
  const ids = res.map((r) => r.docId.toLowerCase());
  const rank = ids.findIndex((id) => t.rx.test(id)) + 1;
  if (rank >= 1 && rank <= 5) r5++;
  if (rank >= 1 && rank <= 10) r10++;
  if (rank >= 1) mrr += 1 / rank;
  if (t.lt.length) { ltN++; if (rank >= 1 && rank <= 10) lt10++; }
  const top8 = ids.slice(0, 8);
  const s = top8.length ? top8.filter((id) => t.rx.test(id)).length / top8.length : 0;
  sSum += s;
  const path = selectPath({ intent: t.intent, retrieved: res.map((r) => ({ docId: r.docId })) });
  const verbs = path.map((p) => p.verb);
  const A = new Set(verbs.filter((v) => LONGTAIL.includes(v)));
  const stage = f1(new Set(t.lt), A);
  const bbIdx = BACKBONE.map((v) => verbs.indexOf(v));
  const order = bbIdx.every((x, i) => x >= 0 && (i === 0 || x > bbIdx[i - 1])) ? 1 : 0;
  const gated = new Set(path.filter((p) => p.gate).map((p) => p.verb));
  const expGates = new Set(["discuss", "plan", "verify", ...t.gates]);
  const gate = [...expGates].every((g) => gated.has(g)) ? 1 : 0;
  const p = 0.6 * stage + 0.25 * order + 0.15 * gate;
  rows.push({ intent: t.intent, rank, s, stage, order, gate, p });
}

const n = TASKS.length;
const R = 0.35 * (r5 / n) + 0.25 * (r10 / n) + 0.25 * (mrr / n) + 0.15 * (lt10 / ltN);
const P = rows.reduce((a, b) => a + b.p, 0) / n;
const S = sSum / n;
const score = 100 * (0.294 * R + 0.471 * P + 0.235 * S);

let out = `# GSD-OC Orchestration Score (per SCORING-DESIGN.md)\n\n`;
out += `**SCORE(no-G) = ${score.toFixed(1)} / 100**  (G = gate/no-deadlock arm pending live gateway)\n\n`;
out += `| Arm | value |\n|---|---|\n`;
out += `| R — retrieval (recall@5 ${(r5 / n).toFixed(2)}, recall@10 ${(r10 / n).toFixed(2)}, MRR ${(mrr / n).toFixed(3)}, longtail@10 ${(lt10 / ltN).toFixed(2)}) | ${R.toFixed(3)} |\n`;
out += `| P — path correctness (stageF1 + backbone order + gate flags) | ${P.toFixed(3)} |\n`;
out += `| S — skill precision@8 | ${S.toFixed(3)} |\n\n`;
out += `## Per-intent\n\n| intent | retr-rank | precision@8 | stageF1 | order | gate | p_i |\n|---|---|---|---|---|---|---|\n`;
for (const r of rows) out += `| ${r.intent} | ${r.rank || "miss"} | ${r.s.toFixed(2)} | ${r.stage.toFixed(2)} | ${r.order} | ${r.gate} | ${r.p.toFixed(2)} |\n`;

console.log(out);
writeFileSync(".planning/SCORING.md", out);
console.log("\nwrote .planning/SCORING.md");
