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

/** Set a top-level scalar frontmatter field (creates the frontmatter block if absent). */
export function setFrontmatterField(content: string, key: string, value: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  const quoted = /[:\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  if (!fm) {
    return `---\n${key}: ${quoted}\n---\n\n${content}`;
  }
  const block = fm[1];
  const line = new RegExp(`^${key}:.*$`, "m");
  const newBlock = line.test(block) ? block.replace(line, `${key}: ${quoted}`) : `${block}\n${key}: ${quoted}`;
  return content.replace(fm[1], newBlock);
}

/** Replace the nested `progress:` frontmatter block's child fields (merge). */
export function setProgressFields(content: string, fields: Record<string, number>): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fm) return content;
  let block = fm[1];
  const prog = /^progress:\n((?:[ \t]+.*\n?)*)/m.exec(block);
  const cur: Record<string, string> = {};
  if (prog) for (const m of prog[1].matchAll(/^[ \t]+([\w]+):[ \t]*(.+)$/gm)) cur[m[1]] = m[2];
  for (const [k, v] of Object.entries(fields)) cur[k] = String(v);
  const rendered = "progress:\n" + Object.entries(cur).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  block = prog ? block.replace(/^progress:\n(?:[ \t]+.*\n?)*/m, rendered + "\n") : block + "\n" + rendered;
  return content.replace(fm[1], block);
}

/** Append a line under a `## <section>` body heading (creates the section if absent). */
export function appendUnderSection(content: string, section: string, line: string): string {
  const head = new RegExp(`^## ${section}\\s*$`, "m");
  if (!head.test(content)) {
    return content.replace(/\s*$/, "") + `\n\n## ${section}\n\n- ${line}\n`;
  }
  // insert right after the heading (and any blank line following it)
  return content.replace(head, (m) => `${m}\n\n- ${line}`);
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
