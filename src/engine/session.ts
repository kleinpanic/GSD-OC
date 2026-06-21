/**
 * OCT-W3 — session lifecycle features (pause/resume + thread + capture). route() HALTS on `.continue-here.md`
 * (Gate 1) and on `paused_at:` in STATE (Route 8), but nothing WROTE them — the feature was half-wired (read
 * side only). These are the writers, plus the thread (cross-session context) and capture (idea/task) stores.
 */
import fs from "node:fs";
import path from "node:path";
import { readModifyWriteStateMd } from "./state.js";
import { setFrontmatterField } from "./mutate.js";

function statePath(planningDir: string): string {
  return path.join(planningDir, "STATE.md");
}

export interface Handoff {
  reason: string;
  next_step?: string;
  resume_hint?: string;
  paused_at: string;
}

/** pause-work — write the structured HANDOFF.json + the human `.continue-here.md` checkpoint, and stamp
 *  `paused_at` in STATE so route() halts at Gate 1 / Route 8. `now` is injected for determinism in tests. */
export function pauseWork(
  planningDir: string,
  opts: { reason: string; nextStep?: string; resumeHint?: string },
  now: string = new Date().toISOString(),
): Handoff {
  const handoff: Handoff = { reason: opts.reason, next_step: opts.nextStep, resume_hint: opts.resumeHint, paused_at: now };
  fs.writeFileSync(path.join(planningDir, "HANDOFF.json"), JSON.stringify(handoff, null, 2) + "\n");
  const md =
    `# Continue Here (GSD checkpoint)\n\nPaused: ${now}\n\n**Reason:** ${opts.reason}\n` +
    (opts.nextStep ? `**Next step:** ${opts.nextStep}\n` : "") +
    (opts.resumeHint ? `**Resume hint:** ${opts.resumeHint}\n` : "") +
    `\nResume with the gsd_session tool (op: resume) — it clears this checkpoint and restores the handoff.\n`;
  fs.writeFileSync(path.join(planningDir, ".continue-here.md"), md);
  readModifyWriteStateMd(statePath(planningDir), (c) => setFrontmatterField(c, "paused_at", now));
  return handoff;
}

/** resume-work — read + delete HANDOFF.json + `.continue-here.md`, clear `paused_at`. One-shot. Returns the
 *  handoff (or null if there was no pause). */
export function resumeWork(planningDir: string): Handoff | null {
  let handoff: Handoff | null = null;
  try {
    handoff = JSON.parse(fs.readFileSync(path.join(planningDir, "HANDOFF.json"), "utf8")) as Handoff;
  } catch {
    handoff = null;
  }
  for (const f of ["HANDOFF.json", ".continue-here.md"]) {
    try {
      fs.rmSync(path.join(planningDir, f));
    } catch {
      /* absent */
    }
  }
  // clear paused_at (empty value → route()'s `paused_at:\s*\S` no longer matches)
  try {
    readModifyWriteStateMd(statePath(planningDir), (c) => setFrontmatterField(c, "paused_at", ""));
  } catch {
    /* no STATE */
  }
  return handoff;
}

/* ── threads — persistent cross-session context notes ─────────────────────────────────────────────── */

function threadsDir(planningDir: string): string {
  return path.join(planningDir, "threads");
}
function threadSlug(name: string): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "thread";
}

/** thread create/append — write/append to `.planning/threads/<slug>.md`. */
export function writeThread(planningDir: string, name: string, content: string, append = true): string {
  const dir = threadsDir(planningDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${threadSlug(name)}.md`);
  const stamp = `\n<!-- ${new Date().toISOString().slice(0, 10)} -->\n`;
  if (append && fs.existsSync(file)) fs.appendFileSync(file, stamp + content + "\n");
  else fs.writeFileSync(file, `# Thread: ${name}\n${stamp}${content}\n`);
  return file;
}

export function listThreads(planningDir: string): string[] {
  try {
    return fs.readdirSync(threadsDir(planningDir)).filter((f) => f.endsWith(".md") && !f.startsWith(".")).map((f) => f.replace(/\.md$/, "")).sort();
  } catch {
    return [];
  }
}

/** thread close — archive `<slug>.md` to `threads/.closed/`. */
export function closeThread(planningDir: string, name: string): boolean {
  const file = path.join(threadsDir(planningDir), `${threadSlug(name)}.md`);
  if (!fs.existsSync(file)) return false;
  const closed = path.join(threadsDir(planningDir), ".closed");
  fs.mkdirSync(closed, { recursive: true });
  fs.renameSync(file, path.join(closed, path.basename(file)));
  return true;
}

/* ── capture — quick idea/task/seed store ────────────────────────────────────────────────────────── */

/** capture — append a dated item to `.planning/CAPTURES.md` under a type heading (idea|task|seed). */
export function capture(planningDir: string, text: string, type = "idea"): boolean {
  if (!text?.trim()) return false;
  const file = path.join(planningDir, "CAPTURES.md");
  const t = ["idea", "task", "seed", "note"].includes(type) ? type : "idea";
  const line = `- [${new Date().toISOString().slice(0, 10)}] (${t}) ${text.trim()}\n`;
  let cur = "";
  try {
    cur = fs.readFileSync(file, "utf8");
  } catch {
    cur = "# Captures\n";
  }
  fs.writeFileSync(file, cur.replace(/\s*$/, "") + "\n" + line);
  return true;
}
