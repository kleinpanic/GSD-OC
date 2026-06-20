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

/** Set a top-level scalar frontmatter field (creates the frontmatter block if absent). */
export function setFrontmatterField(content: string, key: string, value: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  const quoted = scalar(value);
  // function replacers everywhere — a raw replacement string lets `$`-sequences in the value corrupt it (CR-1).
  if (!fm) {
    return `---\n${key}: ${quoted}\n---\n\n${content}`;
  }
  const block = fm[1];
  const line = new RegExp(`^${escapeRe(key)}:.*$`, "m");
  const newBlock = line.test(block) ? block.replace(line, () => `${key}: ${quoted}`) : `${block}\n${key}: ${quoted}`;
  return content.replace(fm[1], () => newBlock);
}

/** Merge child fields into the nested `progress:` frontmatter block. Updates direct scalar children in place
 *  and appends new keys; any non-direct-child line (deeper-nested block, comment) passes through verbatim so
 *  a nested structure is never destructively flattened (MED-2). */
export function setProgressFields(content: string, fields: Record<string, number>): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fm) return content;
  const block = fm[1];
  const prog = /^progress:\n((?:[ \t]+.*\n?)*)/m.exec(block);
  if (!prog) {
    const rendered = "progress:\n" + Object.entries(fields).map(([k, v]) => `  ${k}: ${v}`).join("\n");
    return content.replace(fm[1], () => block + "\n" + rendered);
  }
  const baseIndent = /^([ \t]+)\S/m.exec(prog[1])?.[1] ?? "  ";
  const childRe = new RegExp(`^${baseIndent}([\\w]+):[ \\t]*(.+)$`);
  const remaining = new Set(Object.keys(fields));
  const lines = prog[1].replace(/\n$/, "").split("\n").map((ln) => {
    const m = childRe.exec(ln);
    if (m && m[1] in fields) {
      remaining.delete(m[1]);
      return `${baseIndent}${m[1]}: ${fields[m[1]]}`;
    }
    return ln; // nested / comment / unknown — preserved verbatim
  });
  for (const k of remaining) lines.push(`${baseIndent}${k}: ${fields[k]}`);
  const rebuilt = "progress:\n" + lines.join("\n");
  const newBlock = block.replace(/^progress:\n(?:[ \t]+.*\n?)*/m, () => rebuilt + "\n");
  return content.replace(fm[1], () => newBlock);
}

/** Append a line at the END of a `## <section>` body block (creates the section if absent). */
export function appendUnderSection(content: string, section: string, line: string): string {
  const head = new RegExp(`^## ${escapeRe(section)}[ \\t]*$`, "m");
  const m = head.exec(content);
  if (!m) {
    return content.replace(/\s*$/, "") + `\n\n## ${section}\n\n- ${line}\n`;
  }
  // Find the section's extent: from after the heading to the next `## ` heading (or EOF), and append the new
  // entry at the end of that block — true append, newest-last, consistent with the create path (MED-1).
  const afterHead = m.index + m[0].length;
  const rest = content.slice(afterHead);
  const nextHead = /\n## /.exec(rest);
  const sectionEnd = nextHead ? afterHead + nextHead.index : content.length;
  const body = content.slice(afterHead, sectionEnd).replace(/\s*$/, "");
  return content.slice(0, afterHead) + body + `\n- ${line}\n` + content.slice(sectionEnd);
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
