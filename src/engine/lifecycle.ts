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
import { type Clock, realClock } from "./state.js";

const PHASE_RE = /^#{2,4}[ \t]*Phase[ \t]+(\d+(?:\.\d+)*)[ \t]*:[ \t]*([^\n]*)$/gim;

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
  let lastInBlock = i; // WARNING: track the block end so a missing **Plans:** line can be INSERTED, not silently no-op'd
  for (let j = i + 1; j < lines.length && !/^#{2,4}\s*Phase\s/i.test(lines[j]); j++) {
    lastInBlock = j;
    if (/^\*\*Plans:\*\*/.test(lines[j])) {
      lines[j] = `**Plans:** ${plans} plans${done}`;
      fs.writeFileSync(roadmapPath(planningDir), lines.join("\n"));
      return true;
    }
  }
  // No Plans line in this phase block (hand-edited / pre-grammar roadmap) — insert one rather than silently
  // failing, so route()/parseRoadmapPhases see the real plan count instead of a stale/absent value.
  lines.splice(lastInBlock + 1, 0, `**Plans:** ${plans} plans${done}`);
  fs.writeFileSync(roadmapPath(planningDir), lines.join("\n"));
  return true;
}

/** phase.complete — annotate a phase `**Status:** Complete` in ROADMAP (display; route() gates on VERIFICATION). */
export function markPhaseComplete(planningDir: string, phaseNum: number | string): boolean {
  const cur = readRoadmap(planningDir);
  if (!cur) return false;
  const lines = cur.split("\n");
  const headRe = new RegExp(`^(#{2,4}\\s*Phase\\s+${String(phaseNum).replace(/\./g, "\\.")}\\s*:.*)$`, "i");
  const i = lines.findIndex((l) => headRe.test(l));
  if (i === -1) return false;
  // BLOCKER: scan for an existing **Status:** anywhere in THIS phase block (up to the next phase heading), not a
  // fixed 6-line window — a Status that sat ≥6 lines below (e.g. after a Depends-On + Plans line) was missed and a
  // DUPLICATE Status got spliced after the heading. Refresh in place if found; else insert right after the heading.
  let statusIdx = -1;
  for (let k = i + 1; k < lines.length && !/^#{2,4}\s*Phase\s/i.test(lines[k]); k++) {
    if (/^\*\*Status:\*\*/.test(lines[k])) { statusIdx = k; break; }
  }
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
/** Extract a SUMMARY one-liner: frontmatter `one-liner` field, else the first bold span after the first heading. */
function extractOneLiner(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---/.exec(normalized);
  if (fm) {
    const m = /^[ \t]*one-liner:[ \t]*(.+)$/im.exec(fm[1]);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "") || null;
  }
  const body = normalized.replace(/^---\n[\s\S]*?\n---\n*/, "");
  const match = body.match(/^#[^\n]*\n+\*\*([^*\n]+)\*\*([^\n]*)/m);
  if (!match) return null;
  const boldInner = match[1].trim();
  // Labeled form ("**One-liner:** prose") → capture prose after the colon; bare form → the bold span itself.
  if (/:\s*$/.test(boldInner)) {
    const prose = match[2].trim();
    return prose.length > 0 ? prose : null;
  }
  return boldInner.length > 0 ? boldInner : null;
}

/** Count tasks in a SUMMARY: prefer `**Tasks:** N`, then `<task` XML tags, then `## Task N` headers. */
function countTasks(content: string): number {
  const field = content.match(/\*\*Tasks:\*\*\s*(\d+)/);
  if (field) return parseInt(field[1], 10);
  const xml = content.match(/<task[\s>]/gi)?.length ?? 0;
  const md = content.match(/##\s*Task\s*\d+/gi)?.length ?? 0;
  return xml || md;
}

export interface MilestoneSummary {
  version: string;
  name: string;
  shipped: string;
  phaseCount: number;
  totalPlans: number;
  totalTasks: number;
  accomplishments: string[];
  archived: string[];
}

/**
 * Generate the milestone summary (native port of upstream `milestone complete`'s summary half): scan the
 * milestone's phases for stats (phase/plan/task counts + SUMMARY one-liners), archive ROADMAP + REQUIREMENTS
 * into `.planning/milestones/`, and write/prepend a reverse-chronological entry to MILESTONES.md. Does NOT move
 * the phases dir — that's `completeMilestone`'s separate concern. Phase scoping is all-current-phases (correct
 * for single-milestone projects; multi-milestone ROADMAP scoping is a future refinement).
 */
export function milestoneSummary(
  planningDir: string,
  version: string,
  opts: { name?: string; clock?: Pick<Clock, "now"> } = {},
): MilestoneSummary {
  const v = (version ?? "").replace(/[^\w.-]/g, "") || "v0";
  const name = opts.name || v;
  const today = new Date((opts.clock ?? realClock).now()).toISOString().split("T")[0];
  const archiveDir = path.join(planningDir, "milestones");
  fs.mkdirSync(archiveDir, { recursive: true });

  let phaseCount = 0,
    totalPlans = 0,
    totalTasks = 0;
  const accomplishments: string[] = [];
  const phasesDir = path.join(planningDir, "phases");
  try {
    for (const d of fs.readdirSync(phasesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!d.isDirectory()) continue;
      phaseCount++;
      const files = fs.readdirSync(path.join(phasesDir, d.name));
      totalPlans += files.filter((f) => /-PLAN\.md$/.test(f) || f === "PLAN.md").length;
      for (const s of files.filter((f) => /-SUMMARY\.md$/.test(f) || f === "SUMMARY.md")) {
        try {
          const content = fs.readFileSync(path.join(phasesDir, d.name, s), "utf8");
          const oneLiner = extractOneLiner(content);
          if (oneLiner) accomplishments.push(oneLiner);
          totalTasks += countTasks(content);
        } catch {
          /* unreadable summary — skip */
        }
      }
    }
  } catch {
    /* no phases */
  }

  const archived: string[] = [];
  const roadmap = path.join(planningDir, "ROADMAP.md");
  if (fs.existsSync(roadmap)) {
    fs.writeFileSync(path.join(archiveDir, `${v}-ROADMAP.md`), fs.readFileSync(roadmap, "utf8"));
    archived.push(`${v}-ROADMAP.md`);
  }
  const req = path.join(planningDir, "REQUIREMENTS.md");
  if (fs.existsSync(req)) {
    const header = `# Requirements Archive: ${v} ${name}\n\n**Archived:** ${today}\n**Status:** SHIPPED\n\nFor current requirements, see \`.planning/REQUIREMENTS.md\`.\n\n---\n\n`;
    fs.writeFileSync(path.join(archiveDir, `${v}-REQUIREMENTS.md`), header + fs.readFileSync(req, "utf8"));
    archived.push(`${v}-REQUIREMENTS.md`);
  }

  const list = accomplishments.map((a) => `- ${a}`).join("\n");
  const entry = `## ${v} ${name} (Shipped: ${today})\n\n**Phases completed:** ${phaseCount} phases, ${totalPlans} plans, ${totalTasks} tasks\n\n**Key accomplishments:**\n${list || "- (none recorded)"}\n\n---\n\n`;
  const milestonesPath = path.join(planningDir, "MILESTONES.md");
  let existing = "";
  try {
    existing = fs.readFileSync(milestonesPath, "utf8");
  } catch {
    /* none */
  }
  if (!existing.trim()) {
    fs.writeFileSync(milestonesPath, `# Milestones\n\n${entry}`);
  } else {
    // Insert after the header line(s) for reverse-chronological order (newest first).
    const headerMatch = existing.match(/^(#{1,3}\s+[^\n]*\n\n?)/);
    if (headerMatch) fs.writeFileSync(milestonesPath, headerMatch[1] + entry + existing.slice(headerMatch[1].length));
    else fs.writeFileSync(milestonesPath, entry + existing);
  }

  return { version: v, name, shipped: today, phaseCount, totalPlans, totalTasks, accomplishments, archived };
}

export function completeMilestone(
  planningDir: string,
  version: string,
  opts: { name?: string; clock?: Pick<Clock, "now"> } = {},
): { archived: boolean; dir: string; summary: MilestoneSummary } {
  const v = (version ?? "").replace(/[^\w.-]/g, "") || "v0";
  // Generate the summary FIRST (it reads phases/) before the phases dir is archived away.
  const summary = milestoneSummary(planningDir, v, opts);
  const phasesDir = path.join(planningDir, "phases");
  // WARNING: route the rename target through assertWithinRoot like scaffoldPhaseDir — the sanitizer already strips
  // separators, but this makes containment explicit + consistent (one regex change can't open a traversal).
  const dest = assertWithinRoot(path.join(planningDir, "milestones"), `${v}-phases`);
  if (!fs.existsSync(phasesDir)) return { archived: false, dir: dest, summary };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(phasesDir, dest);
  fs.mkdirSync(phasesDir, { recursive: true }); // fresh phases/ for the next milestone
  return { archived: true, dir: dest, summary };
}
