import fs from "node:fs";
import path from "node:path";
import { findPhase, comparePhaseNum, phaseTokenMatches } from "./phase.js";

/**
 * Next-phase route function (STATE-03 / D-04).
 *
 * A PURE function of the files present in a `.planning/` directory: same inputs →
 * same route, no writes, no process.exit. Reproduces the `next.md` route table —
 * hard-stop Gates 1-3 (§38-84), Route 0 resume-incomplete (§89-139), and Routes 1-8
 * (§220-254). `next.md` is a READ-ONLY behavioral spec (R0.3): no shelling gsd-tools,
 * no opengsd. Composes findPhase (plan 02-02) and readState (re-exported by plan 02-01).
 */

export type RouteResult = {
  /** Numeric route id (0-8) or "halt" for a hard-stop gate. */
  route: number | "halt";
  /** GSD verb for forward routes, or the halt sentinel. */
  action: string;
  /** Phase number the action targets, or null. */
  phase: string | null;
  /** Human-readable reason. */
  reason: string;
};

/** A phase as declared in ROADMAP.md `### Phase N:` headings, in document order. */
type RoadmapPhase = { number: string; name: string };

function parseRoadmapPhases(planningDir: string): RoadmapPhase[] {
  const roadmapPath = path.join(planningDir, "ROADMAP.md");
  let content: string;
  try {
    content = fs.readFileSync(roadmapPath, "utf8");
  } catch {
    return [];
  }
  const phases: RoadmapPhase[] = [];
  // `### Phase N:` / `## Phase N.1:` etc. — capture the phase number and name.
  const re = /^#{2,4}\s*Phase\s+(\d+(?:\.\d+)*)\s*:\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    phases.push({ number: m[1], name: m[2].trim() });
  }
  return phases;
}

/**
 * Minimal STATE.md status reader. Mirrors read-state.ts precedence (WR-01): the
 * frontmatter `status:` scalar is the baseline, but a `Status:` field inside the
 * `## Current Position` body section overrides it when present — so a human-set body
 * `error`/`failed` halts. Quotes are stripped on both branches (WR-02): `Status: "failed"`
 * is detected as a halt.
 */
function readStatus(planningDir: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(planningDir, "STATE.md"), "utf8");
  } catch {
    return null;
  }
  const stripQuotes = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");
  let status: string | null = null;
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (fm) {
    const s = /^status:[ \t]*(.+)$/im.exec(fm[1]);
    if (s) status = stripQuotes(s[1]);
  }
  // Body `## Current Position` Status overrides frontmatter (read-state.ts:73-90).
  const section = /##\s*Current Position\s*\n([\s\S]*?)(?=\n##|$)/i.exec(raw);
  if (section) {
    const body = section[1];
    const bold = /\*\*Status:\*\*[ \t]*(.+)/i.exec(body);
    const plain = /^Status:[ \t]*(.+)$/im.exec(body);
    const bodyStatus = bold ? bold[1] : plain ? plain[1] : null;
    if (bodyStatus) status = stripQuotes(bodyStatus);
  }
  return status;
}

/** STATE.md `paused_at: <non-empty>` presence (Route 8). */
function hasPausedAt(planningDir: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(planningDir, "STATE.md"), "utf8");
  } catch {
    return false;
  }
  return /^[ \t]*paused_at:[ \t]*\S/im.test(raw);
}

/** Locate a phase directory under phases/ for a roadmap phase number. */
function phaseDirFor(planningDir: string, phaseNum: string): string | null {
  const phasesDir = path.join(planningDir, "phases");
  let dirs: string[];
  try {
    // WR-03: sort by comparePhaseNum identically to findPhase, so both helpers resolve the
    // SAME directory when multiple dirs share a phase token (deterministic single-dir pick).
    dirs = fs
      .readdirSync(phasesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => comparePhaseNum(a, b));
  } catch {
    return null;
  }
  const norm = phaseNum.replace(/^0+(?=\d)/, "");
  const padded = norm.replace(/^(\d+)/, (d) => d.padStart(2, "0"));
  const match = dirs.find((d) => phaseTokenMatches(d, padded));
  return match ? path.join(phasesDir, match) : null;
}

/** Scan a phase VERIFICATION.md for an unresolved FAIL (a FAIL line without an override). */
function hasUnresolvedVerificationFail(planningDir: string, phases: RoadmapPhase[]): boolean {
  for (const ph of phases) {
    const dir = phaseDirFor(planningDir, ph.number);
    if (!dir) continue;
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const vfiles = files.filter((f) => f === "VERIFICATION.md" || f.endsWith("-VERIFICATION.md"));
    for (const vf of vfiles) {
      let content: string;
      try {
        content = fs.readFileSync(path.join(dir, vf), "utf8");
      } catch {
        continue;
      }
      for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (line.startsWith("#")) continue; // skip headings/comments
        if (!/\bFAIL(ED)?\b/i.test(line)) continue;
        // H-01: anchor to the verdict grammar, not bare prose. Ignore negations
        // ("No FAIL conditions remain"), resolutions, and override-marked lines.
        if (/\b(no|zero|0)\b[^.]*\bfail/i.test(line)) continue;
        if (/\b(resolved|override|overridden|n\/a|not applicable|pass(ed)?)\b/i.test(line)) continue;
        // A real unresolved FAIL is a delimited verdict value:
        //  - status/result/verdict field:  "status: failed", "Result: FAIL"
        //  - a table cell:                 "| FAIL |"
        //  - an unchecked checklist item:  "- [ ] ... FAIL"
        if (
          /\b(status|result|verdict|outcome)\b\s*[:=]\s*"?\s*FAIL(ED)?\b/i.test(line) ||
          /(^|\|)\s*FAIL(ED)?\s*(\||$)/i.test(line) ||
          /^[-*]\s*\[\s*\]\s.*\bFAIL(ED)?\b/i.test(line)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * True iff the phase has a VERIFICATION.md whose status is `passed` (the explicit "verification passed"
 * state transition codex F2 found missing — without it, complete-milestone is unreachable).
 */
function verificationPassed(planningDir: string, phaseNum: string): boolean {
  const dir = phaseDirFor(planningDir, phaseNum);
  if (!dir) return false;
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith("VERIFICATION.md"));
  } catch {
    return false;
  }
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    // M-2: split lines, skip `#` headings, and anchor the verdict to a field value or a delimited table cell
    // (the old bare `(^|\|)PASS($)` matched ANY standalone `PASS` line incl. a `# PASSED` heading — a
    // false-positive that could complete-milestone prematurely). R7-HIGH: strip markdown bold markers first so
    // `**Status:** PASSED` (the standard GSD verdict convention, used in every real VERIFICATION.md) is
    // recognized — mirroring readStatus + hasUnresolvedVerificationFail, which both tolerate bold.
    let passed = false;
    for (const raw of text.split("\n")) {
      if (raw.trim().startsWith("#")) continue; // a heading is never a verdict
      const ln = raw.replace(/\*\*/g, "").trim(); // drop bold so `**Status:**` reads as `Status:`
      if (
        /^(status|result|verdict|outcome)\b[ \t]*[:=][ \t]*"?\s*pass(ed)?\b/i.test(ln) ||
        /^\|.*\bPASS(ED)?\b.*\|$/i.test(ln)
      ) {
        passed = true;
        break;
      }
    }
    if (passed) return true;
  }
  return false;
}

export function route(planningDir: string): RouteResult {
  // ── Hard-stop gates (next.md §38-84) — fire before any forward route ──
  // Gate 1: unresolved checkpoint.
  if (fs.existsSync(path.join(planningDir, ".continue-here.md"))) {
    return { route: "halt", action: "halt", phase: null, reason: "unresolved-checkpoint" };
  }
  const status = readStatus(planningDir);
  // Gate 2: error/failed status.
  if (status && /^(error|failed)$/i.test(status)) {
    return { route: "halt", action: "halt", phase: null, reason: "error-state" };
  }

  const phases = parseRoadmapPhases(planningDir);

  // Gate 3: unresolved VERIFICATION FAIL.
  if (hasUnresolvedVerificationFail(planningDir, phases)) {
    return { route: "halt", action: "halt", phase: null, reason: "verification-fail" };
  }

  // ── Route 0: resume incomplete phase (next.md §89-139) — fires before Routes 1-8 ──
  // Scan ALL phases in ROADMAP order; first with plans.length > summaries.length.
  const ordered = [...phases].sort((a, b) => comparePhaseNum(a.number, b.number));
  for (const ph of ordered) {
    const fp = findPhase(planningDir, ph.number);
    if (fp.found && fp.plans.length > fp.summaries.length) {
      return { route: 0, action: "execute-phase", phase: ph.number, reason: "resume-incomplete" };
    }
  }

  // ── Routes 1-8 (next.md §220-254) ──
  // Route 8: paused.
  if (hasPausedAt(planningDir)) {
    return { route: 8, action: "resume-work", phase: null, reason: "paused" };
  }

  // No phase directories on disk yet → Route 1 (discuss the first phase).
  const phasesDirExists = fs.existsSync(path.join(planningDir, "phases"));
  let anyPhaseDir = false;
  if (phasesDirExists) {
    try {
      anyPhaseDir = fs.readdirSync(path.join(planningDir, "phases"), { withFileTypes: true }).some((e) => e.isDirectory());
    } catch {
      anyPhaseDir = false;
    }
  }
  if (phases.length > 0 && !anyPhaseDir) {
    return { route: 1, action: "discuss-phase", phase: phases[0].number, reason: "no-phase-dirs" };
  }

  // Walk phases in ROADMAP order; act on the first phase that is not fully complete.
  for (const ph of ordered) {
    const dir = phaseDirFor(planningDir, ph.number);
    const fp = findPhase(planningDir, ph.number);

    // Route 2: phase dir absent or has neither CONTEXT.md nor RESEARCH.md → discuss.
    // H-02: guard this fs read (the one previously-unguarded read) so route() honors its
    // no-throw contract under ENOENT/EACCES/rename races (it runs inside the finalize hook).
    let hasContext = false;
    if (dir) {
      try {
        hasContext = fs
          .readdirSync(dir)
          .some((f) => f.endsWith("CONTEXT.md") || f.endsWith("RESEARCH.md"));
      } catch {
        hasContext = false;
      }
    }
    if (!dir || !hasContext) {
      if (fp.plans.length === 0) {
        return { route: 2, action: "discuss-phase", phase: ph.number, reason: "no-context" };
      }
    }

    // Route 3: has context (or research) but no PLAN.md → plan.
    if (hasContext && fp.plans.length === 0) {
      return { route: 3, action: "plan-phase", phase: ph.number, reason: "context-no-plans" };
    }

    // Route 4: plans exist, not all have summaries → execute. (Route 0 covers cross-phase;
    // this is the current-phase forward equivalent.)
    if (fp.plans.length > 0 && fp.summaries.length < fp.plans.length) {
      return { route: 4, action: "execute-phase", phase: ph.number, reason: "plans-incomplete" };
    }

    // Route 5: all plans have summaries → verify. (Phase complete; continue to next phase
    // only after verification — so Route 5 fires before advancing.)
    if (fp.plans.length > 0 && fp.summaries.length === fp.plans.length) {
      // CR-01: a complete phase must be verified before the walk advances — for ALL phases,
      // not just the last. A non-last complete-but-unverified phase previously fell through
      // (silently skipping verification) and could surface a later phase's discuss/plan route.
      // Now any complete phase returns verify-work until verification PASSES; only then does
      // the loop advance. Route 7 (complete-milestone) becomes reachable only once every phase
      // is verified.
      if (!verificationPassed(planningDir, ph.number)) {
        return { route: 5, action: "verify-work", phase: ph.number, reason: "all-summaries" };
      }
      continue;
    }
  }

  // Route 6: every phase complete and a next phase exists but the last phase is verified —
  // advance to discuss the next undiscussed phase (handled by the loop above falling through).
  // Route 7: all phases complete → complete milestone.
  if (phases.length > 0) {
    return { route: 7, action: "complete-milestone", phase: null, reason: "all-complete" };
  }

  // No roadmap phases at all → discuss the first phase (degenerate Route 1).
  return { route: 1, action: "discuss-phase", phase: null, reason: "no-phases" };
}
