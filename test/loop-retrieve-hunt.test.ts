import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadVectorCache } from "../src/retrieval/vectors.js";
import { selectPath } from "../src/orchestrate/select-path.js";
import { instructionFor } from "../src/orchestrate/inject.js";
import { scratchDir } from "./helpers/scratch.js";

test("BLOCKER #1: a corrupt vector index.json degrades to null, never throws (retrieve stays graceful)", () => {
  const d = scratchDir("vec");
  writeFileSync(join(d, "v.bin"), Buffer.alloc(8));
  writeFileSync(join(d, "v.json"), "{ this is not valid json");
  assert.doesNotThrow(() => {
    const c = loadVectorCache({ bin: join(d, "v.bin"), index: join(d, "v.json") });
    assert.equal(c, null, "corrupt index → null (degrade), not a thrown SyntaxError");
  });
});

test("BLOCKER #2: the consensus backstop fires a single-doc category from retrieval (no intent keyword)", () => {
  // intent has NO debug/secure/docs keyword — activation must come from retrieval consensus (≥2 distinct docs).
  const debug = selectPath({
    intent: "make the thing behave properly",
    retrieved: [{ docId: "workflow:debug" }, { docId: "agent:gsd-debugger" }, { docId: "agent:gsd-debug-session-manager" }, { docId: "workflow:plan-phase" }, { docId: "workflow:execute-phase" }],
  });
  assert.ok(debug.some((s) => s.verb === "debug"), "debug consensus backstop fires (was structurally dead)");

  // an engaging intent (build) with NO secure keyword — secure must come from retrieval consensus
  const secure = selectPath({
    intent: "build the payment processing module",
    retrieved: [{ docId: "workflow:secure-phase" }, { docId: "agent:gsd-security-auditor" }, { docId: "workflow:plan-phase" }, { docId: "workflow:execute-phase" }, { docId: "workflow:verify-work" }],
  });
  assert.ok(secure.some((s) => s.verb === "secure"), "secure consensus backstop fires");
});

test("#5: instructionFor emits a STOP notice for terminal actions, never 'proceed to the halt step'", () => {
  const halt = instructionFor({ action: "halt", phase: null, reason: "verification-fail" } as never);
  assert.doesNotMatch(halt, /Proceed to the halt/, "no self-contradicting 'proceed to halt'");
  assert.match(halt, /Halted/);
  const done = instructionFor({ action: "complete-milestone", phase: null } as never);
  assert.match(done, /milestone is complete/);
  // a normal mechanical action still advances
  assert.match(instructionFor({ action: "execute-phase", phase: "2" } as never), /Proceed.*execute-phase.*phase 2/);
});
