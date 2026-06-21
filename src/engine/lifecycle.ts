/**
 * OCT-W1 — the GSD WRITE engine. The orchestrator could decide the next action (route()) but could not WRITE
 * the artifacts that record it. This module is the native port of the load-bearing mutation verbs: phase CRUD
 * (phase.add/scaffold/complete), roadmap.update-plan-progress, requirements.mark-complete, milestone.complete.
 * Output is `route()`-parseable by construction (the `### Phase N: name` + `**Goal:**` + `**Plans:** N plans`
 * grammar route.ts:parseRoadmapPhases consumes), so the engine can write what it routes.
 */
import fs from "node:fs";
import path from "node:path";
import { assertWithinRoot } from "./security.js";

const PHASE_RE = /^#{2,4}\s*Phase\s+(\d+(?:\.\d+)*)\s*:\s*(.+)$/gim;

function roadmapPath(planningDir: string): string {
  return path.join(planningDir, "ROADMAP.md");
}
function readRoadmap(planningDir: string): string {
  try {
    return fs.readFileSync(roadmapPath(planningDir), "utf8");
  } catch {
    return "";
  }
}

/** Slug a phase name for its directory (`03-add-auth`). */
function phaseSlug(name: string): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "phase";
}

/** The next top-level phase number = max existing integer phase + 1 (1 if none). */
export function nextPhaseNumber(planningDir: string): number {
  let max = 0;
  for (const m of readRoadmap(planningDir).matchAll(PHASE_RE)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Append a new `### Phase N: name` block to ROADMAP.md (route()-parseable). Returns the new phase number. */
export function addPhase(
  planningDir: string,
  name: string,
  opts: { goal?: string; requirements?: string; dependsOn?: string } = {},
): { number: number; name: string } {
  if (!name?.trim()) throw new Error("addPhase: name required");
  const num = nextPhaseNumber(planningDir);
  const dep = opts.dependsOn ? `\n**Depends-On:** ${opts.dependsOn}` : "";
  const block =
    `\n### Phase ${num}: ${name.trim()}\n\n` +
    `**Goal:** ${opts.goal ?? "[To be planned]"}\n` +
    `**Requirements:** ${opts.requirements ?? "TBD"}${dep}\n` +
    `**Plans:** 0 plans\n`;
  const cur = readRoadmap(planningDir);
  const base = cur.trim() ? cur.replace(/\s*$/, "") : "# Roadmap";
  fs.writeFileSync(roadmapPath(planningDir), base + "\n" + block);
  return { number: num, name: name.trim() };
}

/** phase.scaffold — create `phases/NN-slug/` (zero-padded). Returns the dir. Idempotent. */
export function scaffoldPhaseDir(planningDir: string, num: number | string, name: string): string {
  const padded = String(num).padStart(2, "0");
  const dir = assertWithinRoot(path.join(planningDir, "phases"), `${padded}-${phaseSlug(name)}`); // containment guard
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** roadmap.update-plan-progress — rewrite a phase's `**Plans:** N plans` line (and optional `(M done)`). */
export function updatePlanProgress(planningDir: string, phaseNum: number | string, plans: number, completed?: number): boolean {
  const cur = readRoadmap(planningDir);
  if (!cur) return false;
  const lines = cur.split("\n");
  const headRe = new RegExp(`^#{2,4}\\s*Phase\\s+${String(phaseNum).replace(/\./g, "\\.")}\\s*:`, "i");
  let i = lines.findIndex((l) => headRe.test(l));
  if (i === -1) return false;
  const done = completed != null ? ` (${completed} done)` : "";
  for (let j = i + 1; j < lines.length && !/^#{2,4}\s*Phase\s/i.test(lines[j]); j++) {
    if (/^\*\*Plans:\*\*/.test(lines[j])) {
      lines[j] = `**Plans:** ${plans} plans${done}`;
      fs.writeFileSync(roadmapPath(planningDir), lines.join("\n"));
      return true;
    }
  }
  return false;
}

/** phase.complete — annotate a phase `**Status:** Complete` in ROADMAP (display; route() gates on VERIFICATION). */
export function markPhaseComplete(planningDir: string, phaseNum: number | string): boolean {
  const cur = readRoadmap(planningDir);
  if (!cur) return false;
  const lines = cur.split("\n");
  const headRe = new RegExp(`^(#{2,4}\\s*Phase\\s+${String(phaseNum).replace(/\./g, "\\.")}\\s*:.*)$`, "i");
  const i = lines.findIndex((l) => headRe.test(l));
  if (i === -1) return false;
  // insert/refresh a Status line right after the heading
  const statusIdx = lines.findIndex((l, k) => k > i && k < i + 6 && /^\*\*Status:\*\*/.test(l));
  if (statusIdx !== -1) lines[statusIdx] = "**Status:** Complete";
  else lines.splice(i + 1, 0, "**Status:** Complete");
  fs.writeFileSync(roadmapPath(planningDir), lines.join("\n"));
  return true;
}

/** requirements.mark-complete — check off `- [ ] REQ-ID` → `- [x]` in REQUIREMENTS.md. */
export function markRequirementComplete(planningDir: string, reqId: string): boolean {
  const p = path.join(planningDir, "REQUIREMENTS.md");
  let cur: string;
  try {
    cur = fs.readFileSync(p, "utf8");
  } catch {
    return false;
  }
  const id = reqId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(\\s*-\\s*)\\[ \\](\\s*\\*?\\*?${id}\\b)`, "im");
  if (!re.test(cur)) return false;
  fs.writeFileSync(p, cur.replace(re, "$1[x]$2"));
  return true;
}

/** milestone.complete / cleanup — archive `phases/` into `milestones/<version>-phases/`. Returns the archive dir. */
export function completeMilestone(planningDir: string, version: string): { archived: boolean; dir: string } {
  const v = (version ?? "").replace(/[^\w.-]/g, "") || "v0";
  const phasesDir = path.join(planningDir, "phases");
  const dest = path.join(planningDir, "milestones", `${v}-phases`);
  if (!fs.existsSync(phasesDir)) return { archived: false, dir: dest };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(phasesDir, dest);
  fs.mkdirSync(phasesDir, { recursive: true }); // fresh phases/ for the next milestone
  return { archived: true, dir: dest };
}
