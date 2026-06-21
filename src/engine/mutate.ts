/**
 * ENG-WRITE-01: GSD state mutations. The native `state.ts` writers (writeStateMd/readModifyWriteStateMd/
 * withStateLock) were dead code — nothing advanced STATE.md, so route() ran on a stale snapshot. This
 * module is the WRITE half of the engine: lock-protected mutations that record work as it completes, so
 * the route machine sees live state. Reimplements the gsd-tools state.* verbs natively (R0.3).
 *
 * All mutations are atomic (readModifyWriteStateMd holds the lock across read→transform→write) and pure in
 * their transform (content string → content string), so the transforms are unit-testable without fs.
 */
import path from "node:path";
import { readModifyWriteStateMd, type Clock, realClock } from "./state.js";

function statePathOf(planningDir: string): string {
  return path.join(planningDir, "STATE.md");
}

/** ISO timestamp from the injected clock (deterministic in tests). */
function nowIso(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}

/** Escape regex-special chars so an interpolated key/section can't form (or break) a pattern (CR-2). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A YAML scalar must be single-line; collapse any newlines so user text can't break the frontmatter (MED-4). */
function scalar(value: string): string {
  const oneLine = value.replace(/\r?\n/g, " ").trim();
  return /[:\s"#]/.test(oneLine) ? `"${oneLine.replace(/"/g, '\\"')}"` : oneLine;
}

/** Normalize CRLF→LF for matching but REMEMBER the original ending, so a CRLF file isn't rewritten whole to LF
 *  on a one-field change (WR-01). Restore CRLF ONLY for a UNIFORMLY-CRLF file — a mixed-ending file normalizes
 *  to LF rather than promoting its bare-LF lines to CRLF (which would mutate lines the transform never touched). */
function withEol(content: string): [string, (s: string) => string] {
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const bareLfCount = (content.match(/(?<!\r)\n/g) || []).length;
  const uniformCrlf = crlfCount > 0 && bareLfCount === 0;
  const lf = content.replace(/\r\n/g, "\n");
  return [lf, (s) => (uniformCrlf ? s.replace(/\n/g, "\r\n") : s)];
}

/** Set a top-level scalar frontmatter field (creates the frontmatter block if absent). */
export function setFrontmatterField(content: string, key: string, value: string): string {
  const [lf, eol] = withEol(content);
  content = lf;
  // BLOCKER: tolerate a leading BOM / blank lines before the opening `---` — otherwise a STATE.md that isn't
  // byte-0-anchored (hand-edited blank top line, BOM) is treated as having NO frontmatter and a SECOND block gets
  // prepended, orphaning the real one. Match the first fenced block allowing leading whitespace/BOM.
  const fm = /^[﻿ \t\r\n]*---\n([\s\S]*?)\n---/.exec(content);
  const quoted = scalar(value);
  // function replacers everywhere — a raw replacement string lets `$`-sequences in the value corrupt it (CR-1).
  if (!fm) {
    return eol(`---\n${key}: ${quoted}\n---\n\n${content}`);
  }
  const block = fm[1];
  const keyRe = new RegExp(`^${escapeRe(key)}:`);
  // REGRESSION FIX (1a): rewrite the key by LINE FILTERING, not regex-empty-then-collapse — the old
  // `.replace(/\n\n+/g,"\n")` destroyed EVERY intentional blank line in the frontmatter on any field update.
  // Keep the first key line (rewritten), drop later duplicate key lines, leave all other lines (incl. blanks) verbatim.
  let wrote = false;
  const lines = block.split("\n");
  const hasKey = lines.some((ln) => keyRe.test(ln));
  const newBlock = hasKey
    ? lines
        .filter((ln) => {
          if (!keyRe.test(ln)) return true; // non-key line — preserve verbatim (blank lines survive)
          if (wrote) return false; // a later DUPLICATE key line — drop it (last-wins YAML hazard)
          wrote = true;
          return true; // the first key line — keep (rewritten below)
        })
        .map((ln) => (keyRe.test(ln) ? `${key}: ${quoted}` : ln))
        .join("\n")
    : `${block}\n${key}: ${quoted}`;
  return eol(content.replace(fm[1], () => newBlock));
}

/** Merge child fields into the nested `progress:` frontmatter block. Updates direct scalar children in place
 *  and appends new keys; any non-direct-child line (deeper-nested block, comment) passes through verbatim so
 *  a nested structure is never destructively flattened (MED-2). */
export function setProgressFields(content: string, fields: Record<string, number>): string {
  const [lf, eol] = withEol(content); // WR-02 match on LF, WR-01 restore original ending on write
  content = lf;
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fm) return eol(content);
  const block = fm[1];
  // Array-based so the empty-block (WR-01) and progress-is-last-key (WR-03) cases can't duplicate the key
  // or inject a stray blank line. Find the `progress:` line, consume its indented children, rebuild in place.
  const lines = block.split("\n");
  const pIdx = lines.findIndex((l) => /^progress:[ \t]*$/.test(l));
  if (pIdx === -1) {
    const rendered = ["progress:", ...Object.entries(fields).map(([k, v]) => `  ${k}: ${v}`)];
    return eol(content.replace(fm[1], () => [...lines, ...rendered].join("\n")));
  }
  let end = pIdx + 1;
  while (end < lines.length && /^[ \t]+/.test(lines[end])) end++;
  const children = lines.slice(pIdx + 1, end);
  const baseIndent = children.find((l) => /^[ \t]+\S/.test(l))?.match(/^([ \t]+)/)?.[1] ?? "  ";
  const childRe = new RegExp(`^${baseIndent}([\\w]+):[ \\t]*(.+)$`);
  const remaining = new Set(Object.keys(fields));
  const merged = children.map((ln) => {
    const m = childRe.exec(ln);
    if (m && m[1] in fields) {
      remaining.delete(m[1]);
      return `${baseIndent}${m[1]}: ${fields[m[1]]}`;
    }
    return ln; // nested / comment / unknown — preserved verbatim (MED-2)
  });
  for (const k of remaining) merged.push(`${baseIndent}${k}: ${fields[k]}`);
  const newBlock = [...lines.slice(0, pIdx), "progress:", ...merged, ...lines.slice(end)].join("\n");
  return eol(content.replace(fm[1], () => newBlock));
}

/** Append a line at the END of a `## <section>` body block (creates the section if absent). */
export function appendUnderSection(content: string, section: string, line: string): string {
  const [lf, eol] = withEol(content);
  content = lf;
  const lines = content.split("\n");
  const headRe = new RegExp(`^## ${escapeRe(section)}[ \\t]*$`);
  const hIdx = lines.findIndex((l) => headRe.test(l));
  if (hIdx === -1) {
    return eol(content.replace(/\s*$/, "") + `\n\n## ${section}\n\n- ${line}\n`);
  }
  // Find the section end: the next top-level `## ` heading NOT inside a code fence (a `## ` line inside a
  // ``` fence is body, not a boundary — WR-04). Then append the entry after the section's last non-blank line.
  let inFence = false;
  let end = lines.length;
  for (let i = hIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  let last = end;
  while (last > hIdx + 1 && lines[last - 1].trim() === "") last--; // trim trailing blanks within the section
  return eol([...lines.slice(0, last), `- ${line}`, ...lines.slice(last)].join("\n"));
}

/* ---- The GSD state.* mutation verbs (lock-protected, atomic) ---- */

function stamp(content: string, clock: Clock): string {
  const iso = nowIso(clock);
  let c = setFrontmatterField(content, "last_updated", iso);
  c = setFrontmatterField(c, "last_activity", iso.slice(0, 10));
  return c;
}

/** state.* — set the project status (e.g. "planning" | "executing" | "complete" | "error"). */
export function setStatus(planningDir: string, status: string, clock: Clock = realClock): void {
  readModifyWriteStateMd(statePathOf(planningDir), (c) => stamp(setFrontmatterField(c, "status", status), clock), clock);
}

/** state.update-progress — record plan/phase completion counts + recompute percent. */
export function recordProgress(
  planningDir: string,
  p: { total_plans?: number; completed_plans?: number; total_phases?: number; completed_phases?: number },
  clock: Clock = realClock,
): void {
  readModifyWriteStateMd(
    statePathOf(planningDir),
    (c) => {
      const fields: Record<string, number> = { ...p };
      if (p.completed_plans != null && p.total_plans != null && p.total_plans > 0) {
        fields.percent = Math.round((p.completed_plans / p.total_plans) * 100);
      }
      return stamp(setProgressFields(c, fields), clock);
    },
    clock,
  );
}

/** state.add-decision — append a dated decision to the body Decisions log. */
export function addDecision(planningDir: string, decision: string, clock: Clock = realClock): void {
  readModifyWriteStateMd(statePathOf(planningDir), (c) => stamp(appendUnderSection(c, "Decisions", `${nowIso(clock).slice(0, 10)} — ${decision}`), clock), clock);
}

/** state.add-blocker — append a blocker to the body Blockers log. */
export function addBlocker(planningDir: string, blocker: string, clock: Clock = realClock): void {
  readModifyWriteStateMd(statePathOf(planningDir), (c) => stamp(appendUnderSection(c, "Blockers", `${nowIso(clock).slice(0, 10)} — ${blocker}`), clock), clock);
}
