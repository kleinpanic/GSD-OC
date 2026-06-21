/**
 * Benchmark trace types. A TaskTrace is the normalized record of ONE task run (live from `~/.openclaw/lcm.db`,
 * or a committed golden fixture for deterministic replay). The metrics + rubric are PURE functions over it, so
 * they're unit-testable without a gateway. See docs/BENCHMARK.md for the measurement methods behind each field.
 */

export type Band = "trivial" | "simple" | "complex" | "auth" | "ai" | "debug" | "docs";

export interface ToolCall {
  name: string;
  input?: unknown;
  status?: string;
  seq: number;
}

export interface TaskTrace {
  taskId: string;
  band: Band;
  gsdOn: boolean;
  toolSequence: ToolCall[];
  /** distinct gsd subagents that ran (subtask_agent), gsd-* only */
  firedSubagents: string[];
  /** ordered backbone verbs seen (plan < execute < verify …) */
  backboneVerbs: string[];
  /** mutating edits that were BLOCKED pre-plan (seq + reason) */
  blockedEdits: { seq: number; reason: string }[];
  /** mutating edits that were ALLOWED while NOT planned — the 0-tolerance failure (M4) */
  falseAllows: number;
  totalTokens: number;
  wallClockMs: number;
  reachedDone: boolean;
}
