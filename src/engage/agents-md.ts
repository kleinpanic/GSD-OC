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

/** The GSD persona block written into a coding workspace's AGENTS.md. */
export function gsdAgentsSection(): string {
  return [
    GSD_BEGIN,
    "## GSD auto-engage (coding / big work)",
    "",
    GSD_META_PROMPT,
    "",
    "When this is coding or multi-step work, drive the GSD lifecycle without waiting for a",
    "slash command: call the `gsd_workflow` router tool to get the authoritative next action,",
    "then `gsd_orchestrate` / the namespace routers to dispatch the right GSD subagent in order",
    "(research → codebase-map → plan → execute → verify → ship). Persist artifacts under",
    "`.planning/` in this project directory. Skip all of this for trivial chat / quick one-offs.",
    "",
    "Opt out for this project by deleting this block or adding a `.gsd-off` file to the project root.",
    GSD_END,
  ].join("\n");
}

/**
 * Merge (insert or refresh) the GSD section into AGENTS.md content idempotently.
 * Returns the new content; unchanged regions are preserved.
 */
export function mergeGsdSection(existing: string | null): string {
  const section = gsdAgentsSection();
  if (!existing || existing.trim() === "") {
    return `# AGENTS.md\n\n${section}\n`;
  }
  const begin = existing.indexOf(GSD_BEGIN);
  if (begin !== -1) {
    const end = existing.indexOf(GSD_END, begin);
    if (end !== -1) {
      // Replace the existing managed block in place (refresh).
      const before = existing.slice(0, begin);
      const after = existing.slice(end + GSD_END.length);
      return `${before}${section}${after}`;
    }
  }
  // Append the section, separated by a blank line.
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${sep}${section}\n`;
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
