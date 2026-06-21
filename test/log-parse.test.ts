import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { listGsdSessions, buildTrace } from "../src/bench/log-parse.js";

const require = createRequire(import.meta.url);

test("log-parse: degrades to []/null on a missing db (never throws)", () => {
  const missing = join(tmpdir(), "no-such-lcm.db");
  assert.deepEqual(listGsdSessions(missing), []);
  assert.equal(buildTrace("s1", { taskId: "t", band: "complex", gsdOn: true }, missing), null);
});

test("log-parse: builds a TaskTrace from real message_parts rows", () => {
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try { ({ DatabaseSync } = require("node:sqlite")); } catch { return; } // skip if sqlite absent
  const dir = mkdtempSync(join(tmpdir(), "gsd-lcm-"));
  const dbPath = join(dir, "lcm.db");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE message_parts (part_id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, part_type TEXT, ordinal INTEGER, tool_name TEXT, tool_input TEXT, tool_status TEXT, subtask_agent TEXT, step_tokens_in INT, step_tokens_out INT)`);
    const ins = db.prepare("INSERT INTO message_parts (session_id, part_type, ordinal, tool_name, tool_input, subtask_agent, step_tokens_in, step_tokens_out) VALUES (?,?,?,?,?,?,?,?)");
    ins.run("S1", "tool", 1, "gsd_orchestrate", JSON.stringify({ command: "plan-phase" }), null, 100, 200);
    ins.run("S1", "subtask", 2, null, null, "gsd-planner", 50, 60);
    ins.run("S1", "tool", 3, "gsd_command", JSON.stringify({ command: "execute-phase" }), null, 0, 10);
    ins.run("S1", "subtask", 4, null, null, "gsd-executor", 0, 0);
    ins.run("S2", "tool", 1, "read", JSON.stringify({ file_path: "x" }), null, 1, 1);
    db.close();

    const sessions = listGsdSessions(dbPath);
    assert.deepEqual(sessions.map((s) => s.sessionId).sort(), ["S1"], "only S1 used a gsd tool");
    const t = buildTrace("S1", { taskId: "build", band: "complex", gsdOn: true, reachedDone: true }, dbPath)!;
    assert.equal(t.toolSequence.length, 2, "2 tool calls (orchestrate + command)");
    assert.deepEqual(t.firedSubagents.sort(), ["gsd-executor", "gsd-planner"]);
    assert.equal(t.totalTokens, 100 + 200 + 50 + 60 + 10, "sums step tokens across all parts");
    assert.deepEqual(t.backboneVerbs, ["plan", "execute"], "backbone derived from command verbs in order");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
