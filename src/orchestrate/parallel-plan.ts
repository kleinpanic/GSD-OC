/**
 * OCT-5 — parallel execute wave. The backbone is sequential, but the `execute` stage fans out: one executor
 * per PLAN.md, each in its OWN worktree (unique name — fixes the verb-collision in the single-unit dispatcher).
 * Executors run CONCURRENTLY; MERGES are SERIALIZED (a single critical section) so a conflict fails only that
 * unit (its branch preserved), never corrupting the others. A dependency barrier (declared `dependsOn`) and a
 * concurrency cap bound the fan-out; `Promise.allSettled` is the post-execute barrier code-review/verify resume after.
 */
import { createWorktree, mergeAndRemoveWorktree, removeWorktree } from "../engine/worktree.js";
import { runSubagent, type RunSubagentApi } from "../dispatch/run-subagent.js";

export interface ExecUnit {
  planId: string;
  planPath?: string;
  worktreeName: string;
  dependsOn: string[];
}

export interface UnitResult {
  unit: ExecUnit;
  status: "merged" | "failed" | "conflict";
  output?: string;
}

export interface WaveOptions {
  maxConcurrency?: number;
}

export interface WaveResult {
  units: UnitResult[];
  allMerged: boolean;
  failedUnits: string[];
}

/** Topological order honoring dependsOn; throws on a cycle. */
function topoOrder(units: ExecUnit[]): ExecUnit[] {
  const byId = new Map(units.map((u) => [u.planId, u]));
  const out: ExecUnit[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0=unseen 1=visiting 2=done
  const visit = (u: ExecUnit) => {
    const s = state.get(u.planId);
    if (s === 2) return;
    if (s === 1) throw new Error(`dependency cycle at ${u.planId}`);
    state.set(u.planId, 1);
    for (const d of u.dependsOn) {
      const dep = byId.get(d);
      if (dep) visit(dep);
    }
    state.set(u.planId, 2);
    out.push(u);
  };
  for (const u of units) visit(u);
  return out;
}

/**
 * Run the execute wave: fan out `dispatchUnit` across units (concurrency-capped, dependency-barriered),
 * collect, and join at a barrier. `dispatchUnit` owns the per-unit create→run→merge lifecycle.
 */
export async function runExecuteWave(
  units: ExecUnit[],
  dispatchUnit: (u: ExecUnit) => Promise<UnitResult>,
  opts: WaveOptions = {},
): Promise<WaveResult> {
  if (units.length === 0) return { units: [], allMerged: true, failedUnits: [] };
  const cap = Math.max(1, Math.min(opts.maxConcurrency ?? Math.min(units.length, 4), 16));
  const ready = topoOrder(units);
  const results = new Map<string, UnitResult>();
  const merged = new Set<string>();
  const inflight = new Set<Promise<void>>();

  const launch = (u: ExecUnit) => {
    const p = dispatchUnit(u).then((r) => {
      results.set(u.planId, r);
      if (r.status === "merged") merged.add(u.planId);
      inflight.delete(p);
    });
    inflight.add(p);
  };

  for (const u of ready) {
    // dependency barrier: wait until every dep has RESOLVED (merged, failed, or conflicted) before deciding.
    while (inflight.size > 0 && !u.dependsOn.every((d) => results.has(d))) await Promise.race(inflight);
    // CR-01: a dep that did NOT merge (conflict/failed) breaks this unit's contract — it must NOT run against a
    // base tree missing its dependency's work. Skip + record a failure (so allMerged/failedUnits stay honest).
    const unmet = u.dependsOn.find((d) => !merged.has(d));
    if (unmet) {
      results.set(u.planId, { unit: u, status: "failed", output: `dependency ${unmet} did not merge` });
      continue;
    }
    while (inflight.size >= cap) await Promise.race(inflight); // concurrency cap
    launch(u);
  }
  await Promise.allSettled(inflight); // BARRIER: join all units

  const list = ready.map((u) => results.get(u.planId)).filter((r): r is UnitResult => !!r);
  return {
    units: list,
    allMerged: list.length === units.length && list.every((r) => r.status === "merged"),
    failedUnits: list.filter((r) => r.status !== "merged").map((r) => r.unit.planId),
  };
}

/** Serialize merges into the base tree (concurrent `git merge` into one working tree corrupts the index). */
export function makeMergeSerializer(repoRoot: string): (name: string) => Promise<{ ok: boolean; error?: string }> {
  let chain: Promise<unknown> = Promise.resolve();
  return (name: string) => {
    const run = chain.then(() => mergeAndRemoveWorktree(repoRoot, name));
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.then((r) => ({ ok: r.ok, error: r.error }));
  };
}

/**
 * Per-unit dispatcher (the live SDK-constrained version): create the worktree, DIRECT the executor into it,
 * then merge (serialized) or abort. The merge gate is the real isolation boundary (no per-run cwd).
 */
export function makeUnitDispatcher(
  api: RunSubagentApi,
  intent: string,
  repoRoot: string,
  baseAgentId?: string,
): (u: ExecUnit) => Promise<UnitResult> {
  const mergeSerial = makeMergeSerializer(repoRoot);
  return async (u: ExecUnit): Promise<UnitResult> => {
    const created = createWorktree(repoRoot, u.worktreeName);
    if (!created.ok) return { unit: u, status: "failed", output: `worktree create failed: ${created.error}` };
    const msg =
      `GSD execute plan ${u.planId}${u.planPath ? ` (${u.planPath})` : ""} for intent: ${intent}.\n\n` +
      `ISOLATION: make ALL edits inside ${created.path} and commit them THERE (git add + git commit). ` +
      `Do not modify files outside it — they are merged back automatically.`;
    const res = await runSubagent(api, "gsd-executor", msg, baseAgentId ? { baseAgentId } : {});
    if (res.status !== "ok") {
      removeWorktree(repoRoot, u.worktreeName); // abort isolation, preserve nothing-merged invariant
      return { unit: u, status: "failed", output: res.error ?? `[${res.status}]` };
    }
    const merged = await mergeSerial(u.worktreeName);
    if (!merged.ok) return { unit: u, status: "conflict", output: merged.error }; // branch preserved for resolution
    return { unit: u, status: "merged", output: res.text };
  };
}
