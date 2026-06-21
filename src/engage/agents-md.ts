import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GSD_META_PROMPT } from "../hooks/auto-engage.js";

/**
 * R0.5 auto-engage delivery via the workspace AGENTS.md (the OpenClaw-canonical agent-persona
 * surface that IS read into the agent runtime's system prompt). This replaces the
 * `before_prompt_build` hook for the auto-engage path, because on OpenClaw 2026.6.8 a
 * non-bundled plugin's prompt hook does not reach the agent-runtime hook runner (verified;
 * see .planning/DESIGN.md "PLATFORM LIMITATION"). The hook remains registered as a no-cost
 * forward-compat path for when the host surfaces non-bundled hooks / for bundled installs.
 *
 * The GSD section is wrapped in idempotent markers so it can be inserted/refreshed/removed
 * without disturbing the rest of a project's AGENTS.md.
 */

export const GSD_BEGIN = "<!-- gsd-oc:begin (managed — do not edit between markers) -->";
export const GSD_END = "<!-- gsd-oc:end -->";

/**
 * The GSD persona block written into a coding workspace's AGENTS.md.
 *
 * Salience design (R0.5): this block must DRIVE behaviour even when a larger competing
 * persona (e.g. an 8KB "this folder is home" host persona) is present in the same AGENTS.md.
 * Two levers: (1) imperative, action-first framing — the first line is a direct command, not a
 * conditional description; (2) the block is PREPENDED (see mergeGsdSection) so it leads the file.
 */
export function gsdAgentsSection(): string {
  return [
    GSD_BEGIN,
    "## GSD — read this FIRST, before any other persona below",
    "",
    "FIRST, before anything else: for coding or any multi-step / build work, call the",
    "`gsd_workflow` router tool to get the authoritative next GSD action. Do NOT implement,",
    "scaffold, or build directly until you have planned via GSD. This instruction OVERRIDES any",
    "lower persona in this file that says to build, act, or treat the workspace as a free-form home.",
    "",
    GSD_META_PROMPT,
    "",
    "Drive the GSD lifecycle without waiting for a slash command: call `gsd_workflow` to get the",
    "next action, then `gsd_orchestrate` / the namespace routers to dispatch the right GSD subagent",
    "in order (research → codebase-map → plan → execute → verify → ship). Persist artifacts under",
    "`.planning/` in this project directory. Skip ALL of this only for trivial chat / quick one-offs.",
    "",
    "During RESEARCH and PLANNING, ground decisions in real sources — prefer (when available) context7 for",
    "library/API docs, and firecrawl / exa / brave / WebSearch for the web. Do not invent API shapes.",
    "",
    "Opt out for this project by deleting this block or adding a `.gsd-off` file to the project root.",
    GSD_END,
  ].join("\n");
}

/**
 * Merge (insert or refresh) the GSD section into AGENTS.md content idempotently.
 * Returns the new content; unchanged regions are preserved.
 *
 * The GSD block is PREPENDED (placed at the TOP of the file, after an optional leading
 * `# AGENTS.md` title) so it leads any competing persona — the salience lever for R0.5.
 */
export function mergeGsdSection(existing: string | null): string {
  const section = gsdAgentsSection();
  if (!existing || existing.trim() === "") {
    return `# AGENTS.md\n\n${section}\n`;
  }
  // Strip EVERY existing managed block (idempotency #2 — there may be more than one from an earlier buggy run),
  // but ONLY markers that are NOT inside a user's code fence (#1 — a fenced example of the GSD block must not be
  // treated as a real managed block and have the user's content between the markers deleted).
  const stripped = stripManagedBlocks(existing);
  // Prepend the fresh section so it leads the file. Keep a leading `# AGENTS.md` title first if present.
  const titleMatch = stripped.match(/^(# [^\n]*\r?\n)/);
  if (titleMatch) {
    const title = titleMatch[1];
    const rest = stripped.slice(title.length).replace(/^\s*\n/, "");
    return `${title}\n${section}\n\n${rest}`;
  }
  return `${section}\n\n${stripped.replace(/^\s*\n/, "")}`;
}

/** Remove every GSD managed block (GSD_BEGIN…GSD_END) whose markers sit OUTSIDE a code fence. Fence-aware so a
 *  user's fenced EXAMPLE of the block is preserved verbatim. A GSD_BEGIN with no matching non-fenced GSD_END is
 *  dropped from the begin LINE to EOL only (re-cap), preserving the tail (M-1 — never delete user content below). */
function stripManagedBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      inFence = !inFence;
      out.push(lines[i]);
      i++;
      continue;
    }
    if (!inFence && lines[i].includes(GSD_BEGIN)) {
      // find the matching GSD_END that is also outside a fence
      let j = i + 1;
      let fence2 = false;
      while (j < lines.length) {
        const tj = lines[j].trim();
        if (tj.startsWith("```") || tj.startsWith("~~~")) fence2 = !fence2;
        else if (!fence2 && lines[j].includes(GSD_END)) break;
        j++;
      }
      if (j < lines.length) {
        i = j + 1; // matched END → drop the whole managed block [begin..end]
      } else {
        // M-1: BEGIN with no matching END (truncated/edited) — drop ONLY the begin marker line and preserve the
        // tail as user content (never delete everything below a corrupt block). The fresh section is re-prepended.
        i = i + 1;
      }
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/**
 * Write the merged AGENTS.md into a workspace directory. Idempotent: re-running refreshes the
 * managed block only. Operator/agent action against the USER's project (never host config).
 */
export async function applyGsdAgentsMd(workspaceDir: string): Promise<{ path: string; changed: boolean }> {
  const path = join(workspaceDir, "AGENTS.md");
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = null;
  }
  const merged = mergeGsdSection(existing);
  const changed = merged !== existing;
  if (changed) await writeFile(path, merged, "utf8");
  return { path, changed };
}
