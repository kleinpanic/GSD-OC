/**
 * Live-log parser — reads a real OpenClaw gateway run from `~/.openclaw/lcm.db` (read-only) and normalizes it
 * into a TaskTrace the metrics + rubric score. This is the "real reviews of the live logs" layer: it audits what
 * the agent ACTUALLY called, in order, with real token counts — not a synthetic replay. Schema verified against
 * the live db (message_parts.{part_type,tool_name,tool_input,subtask_agent,step_tokens_in/out}, conversations).
 *
 * node:sqlite is experimental in Node 22 but stable enough for a read-only analytics read; we open with the
 * readOnly flag and never write. Absent db / locked db degrades to [] so the bench never crashes a run.
 */
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { TaskTrace, Band, ToolCall } from "./types.js";

const require = createRequire(import.meta.url);

export function defaultDbPath(): string {
  return path.join(os.homedir(), ".openclaw", "lcm.db");
}

interface PartRow {
  part_type: string;
  tool_name: string | null;
  tool_input: string | null;
  tool_status: string | null;
  subtask_agent: string | null;
  step_tokens_in: number | null;
  step_tokens_out: number | null;
  ordinal: number;
}

/** Open the db read-only. Returns null if absent or node:sqlite is unavailable (degrade, never throw). */
function openDb(dbPath: string): { all(sql: string, ...p: unknown[]): unknown[]; close(): void } | null {
  if (!existsSync(dbPath)) return null;
  try {
    // dynamic import keeps the experimental dep off the hot path / out of environments without it
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    return {
      all: (sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as unknown[],
      close: () => db.close(),
    };
  } catch {
    return null;
  }
}

/** Session ids (conversations) that used any gsd_* tool — the candidate task runs. */
export function listGsdSessions(dbPath = defaultDbPath()): { sessionId: string; calls: number }[] {
  const db = openDb(dbPath);
  if (!db) return [];
  try {
    const rows = db.all(
      "SELECT session_id AS sessionId, COUNT(*) AS calls FROM message_parts WHERE tool_name LIKE 'gsd%' GROUP BY session_id ORDER BY calls DESC",
    ) as { sessionId: string; calls: number }[];
    return rows;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Build a TaskTrace for one session. band/gsdOn/reachedDone are labels the caller supplies (the harness knows). */
export function buildTrace(
  sessionId: string,
  label: { taskId: string; band: Band; gsdOn: boolean; reachedDone?: boolean },
  dbPath = defaultDbPath(),
): TaskTrace | null {
  const db = openDb(dbPath);
  if (!db) return null;
  try {
    const parts = db.all(
      "SELECT part_type, tool_name, tool_input, tool_status, subtask_agent, step_tokens_in, step_tokens_out, ordinal FROM message_parts WHERE session_id = ? ORDER BY ordinal",
      sessionId,
    ) as PartRow[];

    const toolSequence: ToolCall[] = [];
    const firedSubagents = new Set<string>();
    let totalTokens = 0;
    for (const p of parts) {
      totalTokens += (p.step_tokens_in ?? 0) + (p.step_tokens_out ?? 0);
      if (p.tool_name) {
        let input: unknown;
        try {
          input = p.tool_input ? JSON.parse(p.tool_input) : undefined;
        } catch {
          input = p.tool_input;
        }
        toolSequence.push({ name: p.tool_name, input, status: p.tool_status ?? undefined, seq: p.ordinal });
      }
      if (p.subtask_agent && p.subtask_agent.startsWith("gsd-")) firedSubagents.add(p.subtask_agent);
    }
    return {
      taskId: label.taskId,
      band: label.band,
      gsdOn: label.gsdOn,
      toolSequence,
      firedSubagents: [...firedSubagents],
      backboneVerbs: deriveBackbone(toolSequence),
      blockedEdits: [],
      falseAllows: 0,
      totalTokens,
      wallClockMs: 0,
      reachedDone: label.reachedDone ?? false,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

const VERB_OF = /(discuss|map-codebase|research|plan|execute|code-review|verify|ship)/;
function deriveBackbone(seq: ToolCall[]): string[] {
  const out: string[] = [];
  for (const c of seq) {
    const cmd = String((c.input as { command?: string })?.command ?? "");
    const m = VERB_OF.exec(cmd);
    if (m && out[out.length - 1] !== m[1]) out.push(m[1]);
  }
  return out;
}
