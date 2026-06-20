/**
 * BENCH-01/02: retrieval benchmark over a fixed task set. For each free-text intent we record whether
 * the expected GSD skill/subagent appears in topK and at what rank, for two arms:
 *   - HYBRID  (semantic spark + LanceDB + BM25 + trigram, RRF)   ← GSD-on
 *   - LEXICAL (BM25 + trigram only, semantic disabled)            ← GSD-off baseline / ablation
 * Reports recall@5, recall@10, and MRR per arm. Run (spark over WG):
 *   SPARK_EMBEDDINGS_BASE_URL=http://10.99.1.1:18091/v1 node --experimental-strip-types scripts/benchmark.ts
 */
import { writeFileSync } from "node:fs";
import { retrieve } from "../dist/retrieval/retrieve.js";

interface Task {
  intent: string;
  // a hit = any returned docId whose id includes one of these substrings
  expect: string[];
  longTail: boolean; // true = a skill the 6 lifecycle routers alone would miss
}

const TASKS: Task[] = [
  { intent: "the build is flaky", expect: ["debug"], longTail: true },
  { intent: "the tests keep failing randomly", expect: ["debug"], longTail: true },
  { intent: "the deployment broke and I can't reproduce it", expect: ["debug"], longTail: true },
  { intent: "review my code for security vulnerabilities", expect: ["code-review", "security", "code-reviewer"], longTail: true },
  { intent: "audit the threat model and mitigations", expect: ["security", "secure"], longTail: true },
  { intent: "capture this idea so I don't forget it", expect: ["capture"], longTail: true },
  { intent: "spike a risky technical approach quickly", expect: ["spike"], longTail: true },
  { intent: "sketch a throwaway UI mockup", expect: ["sketch", "ui"], longTail: true },
  { intent: "evaluate my AI agent's output quality", expect: ["eval"], longTail: true },
  { intent: "build a knowledge graph of the project", expect: ["graphify", "graph"], longTail: true },
  { intent: "write documentation for the project", expect: ["doc"], longTail: true },
  { intent: "plan the next phase of work", expect: ["plan", "planner"], longTail: false },
  { intent: "map the codebase architecture", expect: ["map-codebase", "codebase-mapper", "codebase"], longTail: false },
  { intent: "verify the phase delivered what it promised", expect: ["verif"], longTail: false },
  { intent: "discuss the requirements before planning", expect: ["discuss"], longTail: false },
  { intent: "execute the planned phase", expect: ["execute"], longTail: false },
  { intent: "research how to implement this feature", expect: ["research"], longTail: false },
  { intent: "ship the milestone and open a PR", expect: ["ship"], longTail: false },
];

function rankOf(results: { docId: string }[], expect: string[]): number {
  for (let i = 0; i < results.length; i++) {
    const id = results[i].docId.toLowerCase();
    if (expect.some((e) => id.includes(e))) return i + 1;
  }
  return 0; // 0 = miss
}

interface ArmScore {
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  rows: { intent: string; rank: number; longTail: boolean; top: string }[];
}

async function runArm(semanticOff: boolean): Promise<ArmScore> {
  const rows: ArmScore["rows"] = [];
  let r5 = 0,
    r10 = 0,
    mrr = 0;
  for (const t of TASKS) {
    const results = await retrieve(t.intent, { topK: 10, semantic: semanticOff ? null : undefined });
    const rank = rankOf(results, t.expect);
    if (rank >= 1 && rank <= 5) r5++;
    if (rank >= 1 && rank <= 10) r10++;
    if (rank >= 1) mrr += 1 / rank;
    rows.push({ intent: t.intent, rank, longTail: t.longTail, top: results[0]?.docId ?? "-" });
  }
  return { recallAt5: r5 / TASKS.length, recallAt10: r10 / TASKS.length, mrr: mrr / TASKS.length, rows };
}

function pct(x: number): string {
  return (x * 100).toFixed(0) + "%";
}

const hybrid = await runArm(false);
const lexical = await runArm(true);

const longTailHybrid = hybrid.rows.filter((r) => r.longTail);
const longTailLex = lexical.rows.filter((r) => r.longTail);
const ltRecall = (rows: typeof longTailHybrid) => rows.filter((r) => r.rank >= 1 && r.rank <= 10).length / rows.length;

let out = `# M1 Retrieval Benchmark (BENCH-01/02)\n\n`;
out += `Task set: ${TASKS.length} intents (${longTailHybrid.length} long-tail the 6 routers miss). Metric: rank of expected skill in topK.\n\n`;
out += `| Arm | recall@5 | recall@10 | MRR | long-tail recall@10 |\n|---|---|---|---|---|\n`;
out += `| HYBRID (semantic+lexical) | ${pct(hybrid.recallAt5)} | ${pct(hybrid.recallAt10)} | ${hybrid.mrr.toFixed(3)} | ${pct(ltRecall(longTailHybrid))} |\n`;
out += `| LEXICAL only (ablation)   | ${pct(lexical.recallAt5)} | ${pct(lexical.recallAt10)} | ${lexical.mrr.toFixed(3)} | ${pct(ltRecall(longTailLex))} |\n\n`;
out += `## Per-intent (rank: hybrid / lexical; 0 = miss)\n\n| intent | long-tail | hybrid | lexical | hybrid top-1 |\n|---|---|---|---|---|\n`;
for (let i = 0; i < TASKS.length; i++) {
  const h = hybrid.rows[i],
    l = lexical.rows[i];
  out += `| ${h.intent} | ${h.longTail ? "yes" : "-"} | ${h.rank || "miss"} | ${l.rank || "miss"} | ${h.top} |\n`;
}

console.log(out);
writeFileSync(".planning/BENCHMARK.md", out);
console.log("\nwrote .planning/BENCHMARK.md");
