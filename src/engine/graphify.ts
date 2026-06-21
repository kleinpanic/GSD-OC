/**
 * Graphify — native port of the READ/QUERY side of upstream `bin/lib/graphify.cjs` (the project knowledge
 * graph). Config-gated + OPTIONAL (the external `graphify` CLI builds the graph; off by default). This engine
 * is pure: it gates on config, reads an existing `.planning/graphs/graph.json`, and answers query/status/diff.
 * The BUILD pipeline (which shells out to the external graphify binary) is intentionally NOT reproduced here —
 * the orchestrator dispatches an agent to run the build, matching upstream's `spawn_agent` directive.
 */
import fs from "node:fs";
import path from "node:path";
import { type Clock, realClock } from "./state.js";

export interface GraphNode {
  id: string;
  label?: string;
  description?: string;
  [k: string]: unknown;
}
export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  relation?: string;
  confidence?: string;
  confidence_score?: string;
  [k: string]: unknown;
}
export interface Graph {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  links?: GraphEdge[];
  hyperedges?: unknown[];
  timestamp?: string;
}

/** Config gate: graphify is enabled only when `.planning/config.json` has `graphify.enabled === true`. Off by default. */
export function isGraphifyEnabled(planningDir: string): boolean {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(planningDir, "config.json"), "utf8"));
    return !!(cfg && cfg.graphify && cfg.graphify.enabled === true);
  } catch {
    return false;
  }
}

export function disabledResponse(): { disabled: true; message: string } {
  return { disabled: true, message: "graphify is not enabled. Enable with: gsd_settings op:set key:graphify.enabled value:true" };
}

export function safeReadJson<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Bidirectional adjacency map from nodes + edges (both directions added — pitfall 3). */
export function buildAdjacencyMap(graph: Graph): Record<string, { target: string; edge: GraphEdge }[]> {
  const adj: Record<string, { target: string; edge: GraphEdge }[]> = {};
  for (const node of graph.nodes ?? []) adj[node.id] = [];
  for (const edge of graph.edges ?? graph.links ?? []) {
    (adj[edge.source] ??= []).push({ target: edge.target, edge });
    (adj[edge.target] ??= []).push({ target: edge.source, edge });
  }
  return adj;
}

export interface SeedExpandResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  seeds: Set<string>;
}

/** Seed-then-expand: match `term` on node label/description (case-insensitive substring), then BFS up to maxHops. */
export function seedAndExpand(graph: Graph, term: string, maxHops = 2): SeedExpandResult {
  const lower = term.toLowerCase();
  const nodeMap = Object.fromEntries((graph.nodes ?? []).map((n) => [n.id, n]));
  const adj = buildAdjacencyMap(graph);

  const seeds = (graph.nodes ?? []).filter(
    (n) => (n.label ?? "").toLowerCase().includes(lower) || (n.description ?? "").toLowerCase().includes(lower),
  );

  const visited = new Set(seeds.map((n) => n.id));
  const edges: GraphEdge[] = [];
  const seenEdge = new Set<string>();
  let frontier = seeds.map((n) => n.id);

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const { target, edge } of adj[id] ?? []) {
        const key = `${edge.source}::${edge.target}::${edge.label ?? ""}`;
        if (!seenEdge.has(key)) {
          seenEdge.add(key);
          edges.push(edge);
        }
        if (!visited.has(target)) {
          visited.add(target);
          next.push(target);
        }
      }
    }
    frontier = next;
  }

  const nodes = [...visited].map((id) => nodeMap[id]).filter(Boolean) as GraphNode[];
  return { nodes, edges, seeds: new Set(seeds.map((n) => n.id)) };
}

export interface BudgetedResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  trimmed: string | null;
  total_nodes: number;
  total_edges: number;
}

/** Apply a token budget by dropping edges by confidence tier (AMBIGUOUS → INFERRED → EXTRACTED); keep seeds. */
export function applyBudget(result: SeedExpandResult, budgetTokens: number | null | undefined): SeedExpandResult | BudgetedResult {
  if (!budgetTokens) return result;
  const ORDER = ["AMBIGUOUS", "INFERRED", "EXTRACTED"];
  const est = (obj: unknown) => Math.ceil(JSON.stringify(obj).length / 4);
  let edges = [...result.edges];
  let omitted = 0;

  for (const tier of ORDER) {
    if (est({ nodes: result.nodes, edges }) <= budgetTokens) break;
    const before = edges.length;
    edges = edges.filter((e) => (e.confidence || e.confidence_score) !== tier);
    omitted += before - edges.length;
  }

  const reachable = new Set<string>();
  for (const e of edges) {
    reachable.add(e.source);
    reachable.add(e.target);
  }
  const nodes = result.nodes.filter((n) => reachable.has(n.id) || result.seeds.has(n.id));
  const unreachable = result.nodes.length - nodes.length;
  return {
    nodes,
    edges,
    trimmed: omitted > 0 ? `[${omitted} edges omitted, ${unreachable} nodes unreachable]` : null,
    total_nodes: nodes.length,
    total_edges: edges.length,
  };
}

function graphPath(planningDir: string): string {
  return path.join(planningDir, "graphs", "graph.json");
}

/** Query the knowledge graph for nodes matching `term` (seed-then-expand BFS), with optional token budget. */
export function graphifyQuery(planningDir: string, term: string, opts: { budget?: number | null } = {}) {
  if (!isGraphifyEnabled(planningDir)) return disabledResponse();
  const gp = graphPath(planningDir);
  if (!fs.existsSync(gp)) return { error: "No graph built yet. Run graphify build first." };
  const graph = safeReadJson<Graph>(gp);
  if (!graph) return { error: "Failed to parse graph.json" };

  let result: SeedExpandResult | BudgetedResult = seedAndExpand(graph, term);
  if (opts.budget) result = applyBudget(result as SeedExpandResult, opts.budget);
  return {
    term,
    nodes: result.nodes,
    edges: result.edges,
    total_nodes: result.nodes.length,
    total_edges: result.edges.length,
    trimmed: (result as BudgetedResult).trimmed ?? null,
  };
}

const STALE_MS = 24 * 60 * 60 * 1000;

/** Status: existence, last build, node/edge/hyperedge counts, staleness (>24h). */
export function graphifyStatus(planningDir: string, clock: Pick<Clock, "now"> = realClock) {
  if (!isGraphifyEnabled(planningDir)) return disabledResponse();
  const gp = graphPath(planningDir);
  if (!fs.existsSync(gp)) return { exists: false, message: "No graph built yet. Run graphify build to create one." };
  const stat = fs.statSync(gp);
  const graph = safeReadJson<Graph>(gp);
  if (!graph) return { error: "Failed to parse graph.json" };
  const age = clock.now() - stat.mtimeMs;
  return {
    exists: true,
    last_build: stat.mtime.toISOString(),
    node_count: (graph.nodes ?? []).length,
    edge_count: (graph.edges ?? graph.links ?? []).length,
    hyperedge_count: (graph.hyperedges ?? []).length,
    stale: age > STALE_MS,
    age_hours: Math.round(age / (60 * 60 * 1000)),
  };
}

/** Topology diff between the current graph and the last-build snapshot (added/removed/changed nodes + edges). */
export function graphifyDiff(planningDir: string) {
  if (!isGraphifyEnabled(planningDir)) return disabledResponse();
  const snapshotPath = path.join(planningDir, "graphs", ".last-build-snapshot.json");
  const gp = graphPath(planningDir);
  if (!fs.existsSync(snapshotPath))
    return { no_baseline: true, message: "No previous snapshot. Run graphify build twice to generate a diff baseline." };
  if (!fs.existsSync(gp)) return { error: "No current graph. Run graphify build first." };
  const current = safeReadJson<Graph>(gp);
  const snapshot = safeReadJson<Graph>(snapshotPath);
  if (!current || !snapshot) return { error: "Failed to parse graph or snapshot file" };

  const curN = Object.fromEntries((current.nodes ?? []).map((n) => [n.id, n]));
  const snapN = Object.fromEntries((snapshot.nodes ?? []).map((n) => [n.id, n]));
  const nodesAdded = Object.keys(curN).filter((id) => !snapN[id]);
  const nodesRemoved = Object.keys(snapN).filter((id) => !curN[id]);
  const nodesChanged = Object.keys(curN).filter((id) => snapN[id] && JSON.stringify(curN[id]) !== JSON.stringify(snapN[id]));

  const ek = (e: GraphEdge) => `${e.source}::${e.target}::${e.relation || e.label || ""}`;
  const curE = Object.fromEntries((current.edges ?? current.links ?? []).map((e) => [ek(e), e]));
  const snapE = Object.fromEntries((snapshot.edges ?? snapshot.links ?? []).map((e) => [ek(e), e]));
  const edgesAdded = Object.keys(curE).filter((k) => !snapE[k]);
  const edgesRemoved = Object.keys(snapE).filter((k) => !curE[k]);
  const edgesChanged = Object.keys(curE).filter((k) => snapE[k] && JSON.stringify(curE[k]) !== JSON.stringify(snapE[k]));

  return {
    nodes: { added: nodesAdded.length, removed: nodesRemoved.length, changed: nodesChanged.length },
    edges: { added: edgesAdded.length, removed: edgesRemoved.length, changed: edgesChanged.length },
    timestamp: snapshot.timestamp ?? null,
  };
}

/** Write a diff snapshot from the current graph.json (the baseline the build pipeline stamps after a build). */
export function writeSnapshot(planningDir: string, clock: Pick<Clock, "now"> = realClock) {
  const graph = safeReadJson<Graph>(graphPath(planningDir));
  if (!graph) return { error: "Cannot write snapshot: graph.json not parseable" };
  const snapshot = {
    version: 1,
    timestamp: new Date(clock.now()).toISOString(),
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? graph.links ?? [],
  };
  const snapshotPath = path.join(planningDir, "graphs", ".last-build-snapshot.json");
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  return { saved: true, timestamp: snapshot.timestamp, node_count: snapshot.nodes.length, edge_count: snapshot.edges.length };
}
