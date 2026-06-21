/**
 * bench — the live-log behavior audit (npm run bench). Reads real OpenClaw gateway runs from ~/.openclaw/lcm.db,
 * normalizes each gsd session into a TaskTrace, and scores BEHAVIOR (token-rot, loop depth, over-orchestration,
 * the deterministic rubric) — auditing what the agent actually did, not a synthetic replay. With no db (CI), it
 * prints the metric definitions and exits 0. This is the quantitative layer on top of `npm run health`.
 *
 *   node --experimental-strip-types scripts/bench.ts [--json]
 */
import { listGsdSessions, buildTrace, defaultDbPath } from "../dist/bench/log-parse.js";
import { tokenRot } from "../dist/bench/metrics.js";
import { scoreBehavior } from "../dist/bench/rubric.js";
import { existsSync } from "node:fs";

const asJson = process.argv.includes("--json");

function main() {
  const db = defaultDbPath();
  if (!existsSync(db)) {
    console.log("No lcm.db — run a real GSD session through the OpenClaw gateway first, then re-run `npm run bench`.");
    console.log("Metrics computed when logs exist: tokens A/B, skill recall, enforcement false-allows, token-rot (redundant reads / loop depth), over-orchestration, lifecycle completion.");
    return;
  }
  const sessions = listGsdSessions(db);
  const rows = sessions.slice(0, 25).map((s) => {
    // ad-hoc live sessions are unlabeled; audit them as complex/GSD-on (behavior audit, not the A/B arm)
    const t = buildTrace(s.sessionId, { taskId: s.sessionId.slice(0, 8), band: "complex", gsdOn: true });
    if (!t) return null;
    const rot = tokenRot(t);
    const score = scoreBehavior(t, t.firedSubagents); // recall vs its own fired set = path-coherence proxy
    return {
      session: s.sessionId.slice(0, 8),
      gsdCalls: t.toolSequence.filter((c) => c.name.startsWith("gsd")).length,
      subagents: t.firedSubagents.length,
      tokens: t.totalTokens,
      redundantReads: rot.redundantReads,
      loopDepth: rot.loopDepth,
      behavior: score.score,
      enforced: !score.failed,
    };
  }).filter(Boolean);

  if (asJson) {
    console.log(JSON.stringify({ db, sessions: rows }, null, 2));
    return;
  }
  console.log(`\nGSD-OC live-log behavior audit — ${rows.length} gsd session(s) in ${db}\n`);
  console.log("session   gsdCalls  subagents  tokens   redReads  loopDepth  behavior  enforced");
  for (const r of rows as Record<string, unknown>[]) {
    console.log(
      `${r.session}  ${String(r.gsdCalls).padStart(7)}  ${String(r.subagents).padStart(8)}  ${String(r.tokens).padStart(7)}  ${String(r.redundantReads).padStart(7)}  ${String(r.loopDepth).padStart(8)}  ${String(r.behavior).padStart(7)}  ${r.enforced ? "yes" : "NO"}`,
    );
  }
  const rotters = (rows as { loopDepth: number }[]).filter((r) => r.loopDepth > 2).length;
  console.log(`\n${rotters} session(s) showed loop-depth > 2 (token-rot signal).`);
}

main();
