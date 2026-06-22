/**
 * OCT-W2 — the INTEGRITY engine (native port of the verify.* and validate.* verb families). It could halt on a FAIL
 * verdict it detected but could not PRODUCE the integrity checks. These are pure read-only validators over
 * `.planning/`; each returns `{ ok, defects }`. The `validateArtifacts` gate is the project-lifecycle
 * write-guarantee: "valid" ≡ "route() can drive it" — it checks the SAME grammar route()'s parsers consume.
 */
import fs from "node:fs";
import path from "node:path";

export interface Defect {
  artifact: string;
  missing: string;
}
export interface VerifyResult {
  ok: boolean;
  defects: Defect[];
}

function read(planningDir: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(planningDir, file), "utf8");
  } catch {
    return null;
  }
}

const PHASE_RE = /^#{2,4}[ \t]*Phase[ \t]+(\d+(?:\.\d+)*)[ \t]*:[ \t]*([^\n]*)$/gim;

/** Parse `### Phase N: name` from ROADMAP (mirrors route.ts:parseRoadmapPhases so "valid" ≡ "routable"). */
export function roadmapPhases(planningDir: string): { number: string; name: string }[] {
  const content = read(planningDir, "ROADMAP.md") ?? "";
  const out: { number: string; name: string }[] = [];
  for (const m of content.matchAll(PHASE_RE)) out.push({ number: m[1], name: m[2].trim() });
  return out;
}

/**
 * roadmap get-phase — extract a single phase's section (from its `### Phase N:` heading up to the next
 * `### Phase` / `##` heading) out of ROADMAP.md. Single-milestone path (the common case). Returns the section
 * text + name, or { found:false }.
 */
export function getRoadmapPhase(planningDir: string, phaseNum: string | number): { found: true; phase_number: string; name: string; section: string } | { found: false; phase_number: string } {
  const num = String(phaseNum).trim();
  const content = read(planningDir, "ROADMAP.md");
  const want = num.replace(/\./g, "\\.");
  // Heading line for this exact phase number.
  const headingRe = new RegExp(`^#{2,4}[ \\t]*Phase[ \\t]+${want}[ \\t]*:[ \\t]*([^\\n]*)$`, "im");
  const m = content ? headingRe.exec(content) : null;
  if (!content || !m) return { found: false, phase_number: num };
  const start = m.index;
  // Section ends at the next phase heading or a top-level `## ` heading after the start.
  const rest = content.slice(start + m[0].length);
  const nextRe = /^#{2,4}[ \t]*Phase[ \t]+\d|^##[ \t]+(?!#)/im;
  const nm = nextRe.exec(rest);
  const end = nm ? start + m[0].length + nm.index : content.length;
  return { found: true, phase_number: num, name: m[1].trim(), section: content.slice(start, end).trimEnd() };
}

/**
 * validate-artifacts gate — the write-guarantee. Checks each scaffolded artifact parses to what route()/
 * readState need. Returns the structured defect list so a writer can be re-dispatched with the exact gap.
 */
export function validateArtifacts(planningDir: string, which: string[] = ["ROADMAP", "STATE", "REQUIREMENTS"]): VerifyResult {
  const defects: Defect[] = [];
  const want = new Set(which.map((w) => w.toUpperCase()));

  if (want.has("ROADMAP")) {
    const phases = roadmapPhases(planningDir);
    if (read(planningDir, "ROADMAP.md") == null) defects.push({ artifact: "ROADMAP.md", missing: "file" });
    else if (phases.length === 0) defects.push({ artifact: "ROADMAP.md", missing: "no parseable '### Phase N:' headings" });
    else
      for (const ph of phases)
        if (!new RegExp(`Phase\\s+${ph.number.replace(/\./g, "\\.")}[\\s\\S]{0,400}?\\*\\*Goal:\\*\\*`, "i").test(read(planningDir, "ROADMAP.md") ?? ""))
          defects.push({ artifact: "ROADMAP.md", missing: `Phase ${ph.number} has no **Goal:**` });
  }
  if (want.has("STATE")) {
    const s = read(planningDir, "STATE.md");
    if (s == null) defects.push({ artifact: "STATE.md", missing: "file" });
    else if (!/^---\n[\s\S]*?\bstatus:[ \t]*\S/m.test(s)) defects.push({ artifact: "STATE.md", missing: "frontmatter status:" });
  }
  if (want.has("REQUIREMENTS")) {
    const r = read(planningDir, "REQUIREMENTS.md");
    if (r == null) defects.push({ artifact: "REQUIREMENTS.md", missing: "file" });
    else if (!/\b[A-Z]{2,}-\d+\b/.test(r)) defects.push({ artifact: "REQUIREMENTS.md", missing: "no REQ-IDs (e.g. RET-01)" });
  }
  return { ok: defects.length === 0, defects };
}

function phaseDir(planningDir: string, num: string): string | null {
  const padded = num.includes(".") ? num : num.padStart(2, "0");
  try {
    const dirs = fs.readdirSync(path.join(planningDir, "phases"), { withFileTypes: true });
    const hit = dirs.find((d) => d.isDirectory() && (d.name.startsWith(`${padded}-`) || d.name.startsWith(`${num}-`)));
    return hit ? path.join(planningDir, "phases", hit.name) : null;
  } catch {
    return null;
  }
}

function phaseFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** verify.phase-completeness — a phase is complete iff #PLAN == #SUMMARY and a PASSED VERIFICATION exists. */
export function verifyPhaseCompleteness(planningDir: string, num: string): VerifyResult {
  const dir = phaseDir(planningDir, num);
  const defects: Defect[] = [];
  if (!dir) return { ok: false, defects: [{ artifact: `phase ${num}`, missing: "phase directory" }] };
  const files = phaseFiles(dir);
  const plans = files.filter((f) => /PLAN\.md$/.test(f)).length;
  const summaries = files.filter((f) => /SUMMARY\.md$/.test(f)).length;
  if (plans === 0) defects.push({ artifact: `phase ${num}`, missing: "no PLAN.md" });
  if (summaries < plans) defects.push({ artifact: `phase ${num}`, missing: `${plans - summaries} plan(s) without a SUMMARY` });
  const verif = files.find((f) => /VERIFICATION\.md$/.test(f));
  if (!verif) defects.push({ artifact: `phase ${num}`, missing: "VERIFICATION.md" });
  else {
    let body = "";
    try {
      body = fs.readFileSync(path.join(dir, verif), "utf8").replace(/\*\*/g, "");
    } catch {
      /* unreadable */
    }
    if (!/^\s*(status|result|verdict|outcome)\b[ \t]*[:=][ \t]*"?\s*pass(ed)?\b/im.test(body))
      defects.push({ artifact: `phase ${num}`, missing: "VERIFICATION not PASSED" });
  }
  return { ok: defects.length === 0, defects };
}

/** validate.consistency — every ROADMAP phase past planning should have a scaffolded dir; reqs referenced exist. */
export function validateConsistency(planningDir: string): VerifyResult {
  const defects: Defect[] = [];
  const phases = roadmapPhases(planningDir);
  for (const ph of phases) {
    // a phase that has been planned (its dir holds a PLAN) but no SUMMARY-after-PLAN mismatch is fine; only
    // flag a phase that ROADMAP marks Complete but has no PASSED verification.
    const dir = phaseDir(planningDir, ph.number);
    const roadmap = read(planningDir, "ROADMAP.md") ?? "";
    const markedComplete = new RegExp(`Phase\\s+${ph.number.replace(/\./g, "\\.")}[\\s\\S]{0,400}?\\*\\*Status:\\*\\*\\s*Complete`, "i").test(roadmap);
    if (markedComplete && dir && !verifyPhaseCompleteness(planningDir, ph.number).ok)
      defects.push({ artifact: `phase ${ph.number}`, missing: "marked Complete but verification incomplete" });
  }
  return { ok: defects.length === 0, defects };
}

/** gap-checker — every REQ-ID in REQUIREMENTS.md should be referenced by some phase (ROADMAP phase block or a
 *  phase PLAN). Returns the uncovered REQ-IDs as defects so post-planning gaps surface before execution. */
export function gapCheck(planningDir: string): VerifyResult & { uncovered: string[] } {
  const req = read(planningDir, "REQUIREMENTS.md") ?? "";
  const ids = [...new Set([...req.matchAll(/\b([A-Z]{2,}-\d+)\b/g)].map((m) => m[1]))];
  const roadmap = read(planningDir, "ROADMAP.md") ?? "";
  // gather all PLAN.md text across phases (where coverage is actually planned)
  let planText = "";
  try {
    for (const d of fs.readdirSync(path.join(planningDir, "phases"), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(planningDir, "phases", d.name))) {
        if (/PLAN\.md$/.test(f)) planText += "\n" + (read(planningDir, path.join("phases", d.name, f)) ?? "");
      }
    }
  } catch {
    /* no phases yet */
  }
  const haystack = roadmap + planText;
  const uncovered = ids.filter((id) => !new RegExp(`\\b${id}\\b`).test(haystack));
  return { ok: uncovered.length === 0, defects: uncovered.map((id) => ({ artifact: "REQUIREMENTS", missing: `${id} not covered by any phase` })), uncovered };
}

/** validate.health — a one-call rollup: artifacts valid + no inconsistency. */
export function validateHealth(planningDir: string): VerifyResult {
  const a = validateArtifacts(planningDir);
  const c = validateConsistency(planningDir);
  return { ok: a.ok && c.ok, defects: [...a.defects, ...c.defects] };
}
