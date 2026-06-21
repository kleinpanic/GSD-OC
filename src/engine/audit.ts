/**
 * OCT-W4b — UAT + open-artifact audit (native port of uat.cjs + audit.cjs). Cross-phase scanners that surface
 * what's unresolved: UAT/VERIFICATION verdicts per phase, and the aggregate open state (blockers, FAILED
 * verifications, uncovered requirements, incomplete phases). Pure read-only over `.planning/`. These are the
 * "audits + milestone tracking" the user asked for — the orchestrator (or the user) runs them to see real status.
 */
import fs from "node:fs";
import path from "node:path";
import { gapCheck, verifyPhaseCompleteness, roadmapPhases } from "./verify.js";

export interface UatPhase {
  phase: string;
  name: string;
  verification: "passed" | "failed" | "missing";
}

function phaseDirs(planningDir: string): { num: string; dir: string }[] {
  const out: { num: string; dir: string }[] = [];
  try {
    for (const d of fs.readdirSync(path.join(planningDir, "phases"), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const m = /^(\d+(?:\.\d+)*)-/.exec(d.name);
      // normalize the dir prefix ("01" → "1") so it matches ROADMAP's "### Phase 1:" numbering
      if (m) out.push({ num: m[1].replace(/^0+(\d)/, "$1"), dir: path.join(planningDir, "phases", d.name) });
    }
  } catch {
    /* none */
  }
  return out.sort((a, b) => parseFloat(a.num) - parseFloat(b.num));
}

/** uat / audit-uat — verification verdict for every phase (the cross-phase UAT scan). */
export function scanUat(planningDir: string): UatPhase[] {
  const names = new Map(roadmapPhases(planningDir).map((p) => [p.number, p.name]));
  return phaseDirs(planningDir).map(({ num, dir }) => {
    let verification: UatPhase["verification"] = "missing";
    try {
      const vf = fs.readdirSync(dir).find((f) => /VERIFICATION\.md$/.test(f));
      if (vf) {
        const body = fs.readFileSync(path.join(dir, vf), "utf8").replace(/\*\*/g, "");
        if (/^\s*(status|result|verdict|outcome)\b[ \t]*[:=][ \t]*"?\s*pass(ed)?\b/im.test(body)) verification = "passed";
        else if (/^\s*(status|result|verdict|outcome)\b[ \t]*[:=][ \t]*"?\s*fail(ed)?\b/im.test(body)) verification = "failed";
      }
    } catch {
      /* unreadable */
    }
    return { phase: num, name: names.get(num) ?? "", verification };
  });
}

export interface OpenItem {
  type: "blocker" | "verification-failed" | "uncovered-requirement" | "incomplete-phase";
  detail: string;
}

/** audit-open — aggregate the unresolved state across `.planning/`. clean ⇒ nothing open. */
export function auditOpen(planningDir: string): { clean: boolean; open: OpenItem[] } {
  const open: OpenItem[] = [];

  // unresolved blockers in STATE.md (## Blockers section, list items)
  try {
    const state = fs.readFileSync(path.join(planningDir, "STATE.md"), "utf8");
    const m = /##\s+Blockers\b([\s\S]*?)(?=\n##\s|$)/i.exec(state);
    if (m) for (const b of m[1].matchAll(/^\s*-\s+(.+)$/gm)) open.push({ type: "blocker", detail: b[1].trim() });
  } catch {
    /* no STATE */
  }

  // FAILED verifications + incomplete phases
  for (const { num: phase } of phaseDirs(planningDir)) {
    const vc = verifyPhaseCompleteness(planningDir, phase);
    for (const d of vc.defects) {
      if (/VERIFICATION not PASSED/.test(d.missing)) open.push({ type: "verification-failed", detail: `phase ${phase}` });
      else if (/SUMMARY|PLAN/.test(d.missing)) open.push({ type: "incomplete-phase", detail: `phase ${phase}: ${d.missing}` });
    }
  }

  // uncovered requirements
  for (const id of gapCheck(planningDir).uncovered) open.push({ type: "uncovered-requirement", detail: id });

  return { clean: open.length === 0, open };
}
