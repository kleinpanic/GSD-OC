import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runExecuteWave, makeMergeSerializer, type ExecUnit } from "../src/orchestrate/parallel-plan.js";
import { createWorktree } from "../src/engine/worktree.js";

function repoInit(): string {
  const repo = mkdtempSync(join(tmpdir(), "gsd-pw-"));
  const g = (a: string[], cwd = repo) => execFileSync("git", a, { cwd, encoding: "utf8" });
  g(["init", "-q", "-b", "main"]); g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]); g(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "base.txt"), "base\n"); g(["add", "base.txt"]); g(["commit", "-qm", "base"]);
  return repo;
}
const units = (n: number): ExecUnit[] => Array.from({ length: n }, (_, i) => ({ planId: `0${i + 1}`, worktreeName: `exec-1-0${i + 1}`, dependsOn: [] }));

test("runExecuteWave: parallel executors, serialized merges, all land on main", async () => {
  const repo = repoInit();
  try {
    // each unit commits a distinct file in its worktree, then merges (serialized) back
    const merge = makeMergeSerializer(repo);
    const dispatch = async (u: { planId: string; worktreeName: string }) => {
      const c = createWorktree(repo, u.worktreeName);
      writeFileSync(join(c.path, `f${u.planId}.txt`), u.planId);
      execFileSync("git", ["add", `f${u.planId}.txt`], { cwd: c.path });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", `u${u.planId}`], { cwd: c.path });
      const m = await merge(u.worktreeName);
      return { unit: u as never, status: (m.ok ? "merged" : "conflict") as "merged" | "conflict", output: m.error };
    };
    const r = await runExecuteWave(units(3), dispatch, { maxConcurrency: 3 });
    assert.ok(r.allMerged, JSON.stringify(r.failedUnits));
    for (const id of ["01", "02", "03"]) assert.ok(existsSync(join(repo, `f${id}.txt`)), `f${id} merged onto main`);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("runExecuteWave: a conflicting unit fails ALONE, others still merge", async () => {
  const repo = repoInit();
  try {
    const merge = makeMergeSerializer(repo);
    // unit 02 edits base.txt (conflicts with a concurrent base edit); 01 + 03 touch distinct files
    const dispatch = async (u: { planId: string; worktreeName: string }) => {
      const c = createWorktree(repo, u.worktreeName);
      const f = u.planId === "02" ? "base.txt" : `f${u.planId}.txt`;
      writeFileSync(join(c.path, f), `from-${u.planId}\n`);
      execFileSync("git", ["add", f], { cwd: c.path });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", `u${u.planId}`], { cwd: c.path });
      // mutate base.txt on main BEFORE 02 merges, to force a conflict on 02 only
      if (u.planId === "02") { writeFileSync(join(repo, "base.txt"), "main-change\n"); execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-aqm", "main-change"], { cwd: repo }); }
      const m = await merge(u.worktreeName);
      return { unit: u as never, status: (m.ok ? "merged" : "conflict") as "merged" | "conflict", output: m.error };
    };
    const r = await runExecuteWave(units(3), dispatch, { maxConcurrency: 1 });
    assert.ok(!r.allMerged);
    assert.deepEqual(r.failedUnits, ["02"]);
    assert.ok(existsSync(join(repo, "f01.txt")) && existsSync(join(repo, "f03.txt")), "01 + 03 still merged");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("runExecuteWave: empty + dependency cycle handling", async () => {
  const r = await runExecuteWave([], async (u) => ({ unit: u, status: "merged" }));
  assert.ok(r.allMerged && r.units.length === 0);
  const cyclic: ExecUnit[] = [{ planId: "a", worktreeName: "a", dependsOn: ["b"] }, { planId: "b", worktreeName: "b", dependsOn: ["a"] }];
  await assert.rejects(runExecuteWave(cyclic, async (u) => ({ unit: u, status: "merged" })), /cycle/);
});

test("CR-01: a unit whose dependency did NOT merge is SKIPPED (not run against a missing-dep tree)", async () => {
  const { runExecuteWave } = await import("../src/orchestrate/parallel-plan.js");
  const units = [
    { planId: "A", worktreeName: "wA", dependsOn: [] },
    { planId: "B", worktreeName: "wB", dependsOn: ["A"] },
  ];
  // A "fails" (conflict); B depends on A → B must be skipped+failed, never dispatched
  let bDispatched = false;
  const dispatch = async (u: { planId: string }) => {
    if (u.planId === "A") return { unit: u as never, status: "conflict" as const };
    bDispatched = true; return { unit: u as never, status: "merged" as const };
  };
  const r = await runExecuteWave(units, dispatch, { maxConcurrency: 1 });
  assert.ok(!bDispatched, "B was NOT dispatched (its dep A failed)");
  assert.ok(!r.allMerged);
  const b = r.units.find((x) => x.unit.planId === "B");
  assert.equal(b!.status, "failed");
  assert.match(b!.output!, /dependency A did not merge/);
});
