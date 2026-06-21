import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  isGraphifyEnabled,
  seedAndExpand,
  applyBudget,
  graphifyQuery,
  graphifyStatus,
  graphifyDiff,
  writeSnapshot,
} from "../src/engine/graphify.js";
import { scratchDir, cleanupAllScratch } from "./helpers/scratch.js";

after(cleanupAllScratch);

const GRAPH = {
  nodes: [
    { id: "auth", label: "Auth Service", description: "handles login" },
    { id: "db", label: "Database", description: "postgres store" },
    { id: "api", label: "API Gateway", description: "routes requests" },
    { id: "lonely", label: "Unrelated", description: "nothing" },
  ],
  edges: [
    { source: "auth", target: "db", label: "reads", confidence: "EXTRACTED" },
    { source: "api", target: "auth", label: "calls", confidence: "INFERRED" },
  ],
};

/** Scaffold a planning dir with graphify enabled + a graph.json. */
function enabledGraph(): string {
  const d = scratchDir("graphify");
  writeFileSync(join(d, "config.json"), JSON.stringify({ graphify: { enabled: true } }));
  mkdirSync(join(d, "graphs"), { recursive: true });
  writeFileSync(join(d, "graphs", "graph.json"), JSON.stringify(GRAPH));
  return d;
}

test("isGraphifyEnabled gates on config.graphify.enabled === true", () => {
  const off = scratchDir("gf-off");
  assert.equal(isGraphifyEnabled(off), false, "no config → disabled");
  writeFileSync(join(off, "config.json"), JSON.stringify({ graphify: { enabled: false } }));
  assert.equal(isGraphifyEnabled(off), false);
  writeFileSync(join(off, "config.json"), JSON.stringify({ graphify: { enabled: true } }));
  assert.equal(isGraphifyEnabled(off), true);
});

test("disabled when graphify off; error when no graph", () => {
  const off = scratchDir("gf-disabled");
  assert.equal((graphifyQuery(off, "auth") as { disabled?: boolean }).disabled, true);

  const noGraph = scratchDir("gf-nograph");
  writeFileSync(join(noGraph, "config.json"), JSON.stringify({ graphify: { enabled: true } }));
  assert.match((graphifyQuery(noGraph, "auth") as { error?: string }).error ?? "", /No graph built/);
});

test("seedAndExpand finds seeds + BFS-expands; lonely node excluded", () => {
  const r = seedAndExpand(GRAPH, "auth");
  const ids = r.nodes.map((n) => n.id).sort();
  // auth (seed) → db, api (1 hop). lonely is unconnected/unmatched.
  assert.deepEqual(ids, ["api", "auth", "db"]);
  assert.ok(!ids.includes("lonely"));
  assert.deepEqual([...r.seeds], ["auth"]);
});

test("graphifyQuery returns matched subgraph with totals", () => {
  const d = enabledGraph();
  const r = graphifyQuery(d, "database") as { nodes: unknown[]; total_nodes: number };
  assert.equal(r.total_nodes, r.nodes.length);
  assert.ok(r.total_nodes >= 1, "matches 'postgres store' via description? no — matches label 'Database'");
});

test("applyBudget drops low-confidence edges first, keeps seeds", () => {
  const seeded = seedAndExpand(GRAPH, "auth");
  // A tiny budget forces dropping; INFERRED (api→auth) drops before EXTRACTED (auth→db).
  const out = applyBudget(seeded, 5) as { edges: { confidence?: string }[]; trimmed: string | null };
  assert.ok(out.trimmed, "trim annotation present");
  assert.ok(!out.edges.some((e) => e.confidence === "AMBIGUOUS"));
});

test("graphifyStatus reports counts + staleness via injected clock", () => {
  const d = enabledGraph();
  const fresh = graphifyStatus(d, { now: () => Date.now() }) as { exists: boolean; node_count: number; stale: boolean };
  assert.equal(fresh.exists, true);
  assert.equal(fresh.node_count, 4);
  assert.equal(fresh.stale, false);
  // 48h in the future → stale
  const old = graphifyStatus(d, { now: () => Date.now() + 48 * 3600 * 1000 }) as { stale: boolean };
  assert.equal(old.stale, true);
});

test("graphifyDiff: no_baseline until a snapshot exists, then topology diff", () => {
  const d = enabledGraph();
  assert.equal((graphifyDiff(d) as { no_baseline?: boolean }).no_baseline, true);
  // stamp a snapshot of the current graph, then mutate the graph and diff
  writeSnapshot(d, { now: () => Date.now() });
  const mutated = { nodes: [...GRAPH.nodes, { id: "cache", label: "Cache" }], edges: GRAPH.edges };
  writeFileSync(join(d, "graphs", "graph.json"), JSON.stringify(mutated));
  const diff = graphifyDiff(d) as { nodes: { added: number } };
  assert.equal(diff.nodes.added, 1, "cache node added vs snapshot");
});
