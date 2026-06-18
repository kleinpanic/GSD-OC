import fs from "node:fs";
import path from "node:path";

/**
 * Decimal phase/plan discovery (STATE-04 / D-05).
 *
 * Ports the cited pure helpers from upstream `core.cjs` (normalizePhaseName 627-650,
 * comparePhaseNum 716-770, extractPhaseToken 774-797, phaseTokenMatches 801-812) and
 * the discovery logic from `phase.cjs` (isCanonicalPlanFile 44, cmdFindPhase 255-325,
 * cmdPhaseNextDecimal 145-197). Those `.cjs` files are READ-ONLY specs (R0.3): this
 * module reproduces their semantics natively and never requires/shells them.
 *
 * Scope: single flat `phases/` search dir (milestones/ layout out of scope, plan 02-02).
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a phase identifier: strip an optional project-code prefix (CK-02 → 02),
 * zero-pad the integer, preserve a letter suffix and a decimal tail. core.cjs:627-650
 * (milestone-prefixed M-NN form is out of scope here — plain numeric + decimal only).
 */
export function normalizePhaseName(phase: string | number): string {
  const str = String(phase);
  const stripped = str.replace(/^[A-Z]{1,6}-(?=\d)/, "");
  const match = stripped.match(/^(\d+)([A-Z])?((?:\.\d+)*)/i);
  if (match) {
    const padded = match[1].padStart(2, "0");
    const letter = match[2] || "";
    const decimal = match[3] || "";
    return padded + letter + decimal;
  }
  return str;
}

/**
 * Compare two phase numbers: integer first, then letter, then decimal tail. A bare
 * integer sorts before its decimals (02 < 02.1). core.cjs:716-770 (plain-numeric path).
 */
export function comparePhaseNum(a: string, b: string): number {
  const sa = String(a).replace(/^[A-Z]{1,6}-(?=\d)/i, "");
  const sb = String(b).replace(/^[A-Z]{1,6}-(?=\d)/i, "");
  const pa = sa.match(/^(\d+)([A-Z])?((?:\.\d+)*)/i);
  const pb = sb.match(/^(\d+)([A-Z])?((?:\.\d+)*)/i);
  if (!pa || !pb) return String(a).localeCompare(String(b));

  const intDiff = parseInt(pa[1], 10) - parseInt(pb[1], 10);
  if (intDiff !== 0) return intDiff;

  const la = (pa[2] || "").toUpperCase();
  const lb = (pb[2] || "").toUpperCase();
  if (la !== lb) {
    if (!la) return -1;
    if (!lb) return 1;
    return la < lb ? -1 : 1;
  }

  const aDec = pa[3] ? pa[3].slice(1).split(".").map((p) => parseInt(p, 10)) : [];
  const bDec = pb[3] ? pb[3].slice(1).split(".").map((p) => parseInt(p, 10)) : [];
  if (aDec.length === 0 && bDec.length > 0) return -1;
  if (bDec.length === 0 && aDec.length > 0) return 1;
  const maxLen = Math.max(aDec.length, bDec.length);
  for (let i = 0; i < maxLen; i++) {
    const av = Number.isFinite(aDec[i]) ? aDec[i] : 0;
    const bv = Number.isFinite(bDec[i]) ? bDec[i] : 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Extract the leading numeric phase token from a directory name. core.cjs:774-797. */
export function extractPhaseToken(dirName: string): string {
  const codePrefixMatch = dirName.match(/^([A-Z]{1,6})-(\d.*)/i);
  let prefix = "";
  let rest = dirName;
  if (codePrefixMatch) {
    prefix = codePrefixMatch[1] + "-";
    rest = codePrefixMatch[2];
  }
  const segments = rest.split("-");
  const tokenSegments: string[] = [];
  for (const seg of segments) {
    if (/^\d/.test(seg)) tokenSegments.push(seg);
    else break;
  }
  if (tokenSegments.length === 0) return dirName;
  return prefix + tokenSegments.join("-");
}

/** True when a directory's phase token matches the normalized phase exactly. core.cjs:801-812. */
export function phaseTokenMatches(dirName: string, normalized: string): boolean {
  const token = extractPhaseToken(dirName);
  if (token.toUpperCase() === normalized.toUpperCase()) return true;
  const stripped = dirName.replace(/^[A-Z]{1,6}-(?=\d)/i, "");
  if (stripped !== dirName) {
    if (extractPhaseToken(stripped).toUpperCase() === normalized.toUpperCase()) return true;
  }
  return false;
}

/** Strict canonical plan filename: `{pp}-{NN}-PLAN.md` or `PLAN.md`. phase.cjs:44. */
export function isCanonicalPlanFile(f: string): boolean {
  return f.endsWith("-PLAN.md") || f === "PLAN.md";
}

/** Canonical summary filename: `{pp}-{NN}-SUMMARY.md` or `SUMMARY.md`. phase.cjs:305. */
export function isCanonicalSummaryFile(f: string): boolean {
  return f.endsWith("-SUMMARY.md") || f === "SUMMARY.md";
}

export type FindPhaseResult = {
  found: boolean;
  directory: string | null;
  phase_number: string | null;
  phase_name: string | null;
  plans: string[];
  summaries: string[];
};

/**
 * Resolve a phase against `${planningDir}/phases`, returning its canonical
 * plans/summaries. A complete phase has plans.length === summaries.length.
 * Reproduces phase.cjs:255-325 (flat phases/ search only).
 */
export function findPhase(planningDir: string, phase: string | number): FindPhaseResult {
  const normalized = normalizePhaseName(phase);
  const notFound: FindPhaseResult = {
    found: false,
    directory: null,
    phase_number: null,
    phase_name: null,
    plans: [],
    summaries: [],
  };

  const phasesDir = path.join(planningDir, "phases");
  let dirs: string[];
  try {
    dirs = fs
      .readdirSync(phasesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => comparePhaseNum(a, b));
  } catch {
    return notFound;
  }

  const match = dirs.find((d) => phaseTokenMatches(d, normalized));
  if (!match) return notFound;

  const dirMatch =
    match.match(/^(?:[A-Z]{1,6}-)(\d+[A-Z]?(?:\.\d+)*)-?(.*)/i) ||
    match.match(/^(\d+[A-Z]?(?:\.\d+)*)-?(.*)/i);
  const phaseNumber = dirMatch ? dirMatch[1] : normalized;
  const phaseName = dirMatch && dirMatch[2] ? dirMatch[2] : null;

  const phaseDir = path.join(phasesDir, match);
  const phaseFiles = fs.readdirSync(phaseDir);
  const plans = phaseFiles.filter(isCanonicalPlanFile).sort();
  const summaries = phaseFiles.filter(isCanonicalSummaryFile).sort();

  return {
    found: true,
    directory: phaseDir,
    phase_number: phaseNumber,
    phase_name: phaseName,
    plans,
    summaries,
  };
}

/**
 * Compute the next decimal phase under a base: N.(max+1) from existing N.x dirs,
 * or N.1 when none exist. Scans `${planningDir}/phases` dir names (ROADMAP scan
 * optional — out of scope for this fixture). Reproduces phase.cjs:145-197.
 */
export function nextDecimalPhase(planningDir: string, basePhase: string | number): string {
  const normalized = normalizePhaseName(basePhase);
  // L-02: a decimal basePhase (e.g. "2.3") previously had its decimal silently
  // discarded by parseInt — nextDecimalPhase("2.3") would compute children of
  // phase 2, not of 2.3. The flat phases/ layout only supports decimal children
  // of an INTEGER base; fail loud rather than return a surprising result.
  if (/\.\d/.test(normalized)) {
    throw new Error(
      `nextDecimalPhase: basePhase must be an integer phase (got ${JSON.stringify(String(basePhase))}); ` +
        `decimal sub-phases cannot themselves have decimal children in the flat phases/ layout`,
    );
  }
  // Return value uses the bare integer form (e.g. "2.3"), matching the plan's behavior spec.
  const baseInt = String(parseInt(normalized, 10));
  const decimalSet = new Set<number>();

  const phasesDir = path.join(planningDir, "phases");
  try {
    const dirs = fs
      .readdirSync(phasesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const dirPattern = new RegExp(`^(?:[A-Z]{1,6}-)?${escapeRegex(normalized)}\\.(\\d+)`);
    for (const dir of dirs) {
      const m = dir.match(dirPattern);
      if (m) decimalSet.add(parseInt(m[1], 10));
    }
  } catch {
    /* no phases dir — fall through to N.1 */
  }

  if (decimalSet.size === 0) return `${baseInt}.1`;
  return `${baseInt}.${Math.max(...decimalSet) + 1}`;
}
