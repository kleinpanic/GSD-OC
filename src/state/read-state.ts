import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Result of reading a `.planning/STATE.md` file.
 *
 * Phase 1 (de-risk slice, D-07): read STATE.md frontmatter + locate the current phase.
 * The full engine (lockfile writes, route table, phase/plan discovery, model resolution,
 * commit) is Phase 2. This reader is native TypeScript — it never shells out to
 * `gsd-tools.cjs` (D-08 / R0.3).
 */
export type ReadStateResult = {
  current_phase: number | null;
  total_phases: number | null;
  current_phase_name: string | null;
  status: string | null;
  last_activity: string | null;
  plan_raw: string | null;
};

const NULL_RESULT: ReadStateResult = {
  current_phase: null,
  total_phases: null,
  current_phase_name: null,
  status: null,
  last_activity: null,
  plan_raw: null,
};

/**
 * Extract a single field from a section body using GSD's field-extraction rule
 * (state-document.cjs:34-43): match `**X:** value` (bold) first, else `^X: value`
 * (plain, multiline, case-insensitive).
 */
function extractField(body: string, field: string): string | null {
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bold = new RegExp(`\\*\\*${esc}:\\*\\*[ \\t]*(.+)`, "i").exec(body);
  if (bold) return bold[1].trim();
  const plain = new RegExp(`^${esc}:[ \\t]*(.+)$`, "im").exec(body);
  return plain ? plain[1].trim() : null;
}

/**
 * Parse the top YAML frontmatter (between leading `---` fences) for a flat scalar key.
 * Minimal — no YAML dependency. Only used for `status` here.
 */
function frontmatterScalar(frontmatter: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${esc}:[ \\t]*(.+)$`, "im").exec(frontmatter);
  if (!m) return null;
  return m[1].trim().replace(/^['"]|['"]$/g, "");
}

/**
 * Read and parse `.planning/STATE.md`. Returns an all-null result if the file is absent
 * or unparseable (Phase 1 is a read-only probe; it never throws on missing state).
 */
export async function readState(planningDir: string): Promise<ReadStateResult> {
  let raw: string;
  try {
    raw = await readFile(join(planningDir, "STATE.md"), "utf8");
  } catch {
    return { ...NULL_RESULT };
  }

  const result: ReadStateResult = { ...NULL_RESULT };

  // Frontmatter: status (authoritative scalar when present).
  // BLOCKER: tolerate CRLF — `---\r\n` otherwise failed `^---\n`, parsing a Windows-saved STATE.md with status=null.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (fm) result.status = frontmatterScalar(fm[1], "status");

  // Body: `## Current Position` section (state.cjs:241).
  const section = /##\s*Current Position\s*\n([\s\S]*?)(?=\n##|$)/i.exec(raw);
  if (section) {
    const body = section[1];

    const phase = extractField(body, "Phase"); // "N of M (Name)"
    if (phase) {
      const pm = /^(\d+)\s+of\s+(\d+)(?:\s*\(([^)]*)\))?/.exec(phase);
      if (pm) {
        result.current_phase = Number(pm[1]);
        result.total_phases = Number(pm[2]);
        result.current_phase_name = pm[3] ? pm[3].trim() : null;
      }
    }

    result.plan_raw = extractField(body, "Plan"); // "X of Y in current phase"
    // Body Status overrides frontmatter when the section carries it.
    const bodyStatus = extractField(body, "Status");
    if (bodyStatus) result.status = bodyStatus;
    result.last_activity = extractField(body, "Last activity");
  }

  return result;
}
