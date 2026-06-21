/**
 * Benchmark metrics (M1–M8) — pure functions over TaskTrace[]. Every number has a method (see docs/BENCHMARK.md).
 * The headline is M1 (tokens-per-task, GSD-on vs GSD-off A/B) and M6 (token-rot, made countable) — the "real
 * scientific measurable metrics" the lifecycle is supposed to move.
 */
import type { TaskTrace, Band } from "./types.js";

const BACKBONE_ORDER = ["discuss", "map-codebase", "research", "plan", "execute", "code-review", "verify", "ship"];

/** M1 — token A/B per band: { band: { on, off, deltaPct } }. deltaPct>0 ⇒ GSD-on used fewer tokens. */
export function tokensAB(traces: TaskTrace[]): Record<string, { on: number; off: number; deltaPct: number | null }> {
  const out: Record<string, { on: number; off: number; deltaPct: number | null }> = {};
  const bands = [...new Set(traces.map((t) => t.band))];
  for (const band of bands) {
    const on = traces.filter((t) => t.band === band && t.gsdOn);
    const off = traces.filter((t) => t.band === band && !t.gsdOn);
    const onTok = avg(on.map((t) => t.totalTokens));
    const offTok = avg(off.map((t) => t.totalTokens));
    out[band] = { on: onTok, off: offTok, deltaPct: offTok > 0 ? (offTok - onTok) / offTok : null };
  }
  return out;
}

/** M2 — lifecycle-completion rate among GSD-on tasks of the given bands (complex by default). */
export function completionRate(traces: TaskTrace[], bands: Band[] = ["complex", "auth", "ai"]): number {
  const t = traces.filter((x) => x.gsdOn && bands.includes(x.band));
  return t.length ? t.filter((x) => x.reachedDone).length / t.length : 1;
}

/** M3 — skill recall/precision vs an expected-subagent label per task. */
export function skillScore(trace: TaskTrace, expected: string[]): { recall: number; precision: number } {
  const fired = new Set(trace.firedSubagents);
  const exp = new Set(expected);
  const hit = [...exp].filter((e) => fired.has(e)).length;
  return {
    recall: exp.size ? hit / exp.size : 1,
    precision: fired.size ? [...fired].filter((f) => exp.has(f)).length / fired.size : 1,
  };
}

/** M4 — enforcement false-allows (mutating edit allowed while NOT planned). Hard 0-tolerance across all traces. */
export function falseAllows(traces: TaskTrace[]): number {
  return traces.reduce((n, t) => n + t.falseAllows, 0);
}

/** M6 — token-rot indicators per trace. */
export function tokenRot(trace: TaskTrace): { redundantReads: number; redundantRetrieves: number; loopDepth: number } {
  const reads = new Map<string, number>();
  const retrieves = new Map<string, number>();
  let loopDepth = 0;
  let run = 0;
  let prevKey = "";
  for (const c of trace.toolSequence) {
    const key = `${c.name}:${JSON.stringify(c.input ?? "")}`;
    run = key === prevKey ? run + 1 : 0;
    if (run > loopDepth) loopDepth = run;
    prevKey = key;
    if (/read/i.test(c.name)) {
      const f = String((c.input as { file_path?: string })?.file_path ?? JSON.stringify(c.input));
      reads.set(f, (reads.get(f) ?? 0) + 1);
    }
    if (/retrieve/i.test(c.name)) {
      const q = String((c.input as { intent?: string })?.intent ?? "").trim().toLowerCase();
      retrieves.set(q, (retrieves.get(q) ?? 0) + 1);
    }
  }
  return {
    redundantReads: [...reads.values()].filter((n) => n > 1).reduce((a, n) => a + (n - 1), 0),
    redundantRetrieves: [...retrieves.values()].filter((n) => n > 1).reduce((a, n) => a + (n - 1), 0),
    loopDepth,
  };
}

/** M7 — over-orchestration: a trivial task that spawned subagents or ran >1 backbone stage. */
export function overOrchestrated(trace: TaskTrace): boolean {
  if (trace.band !== "trivial") return false;
  return trace.firedSubagents.length > 0 || trace.backboneVerbs.length > 1;
}

/** Backbone ordering: are the seen verbs in canonical lifecycle order (no execute-before-plan)? */
export function backboneOrdered(trace: TaskTrace): boolean {
  const idx = trace.backboneVerbs.map((v) => BACKBONE_ORDER.indexOf(v)).filter((i) => i >= 0);
  return idx.every((v, i) => i === 0 || v >= idx[i - 1]);
}

function avg(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, n) => a + n, 0) / ns.length) : 0;
}
