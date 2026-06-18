import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readState } from "../src/state/read-state.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePlanning = join(here, "..", "..", "test", "fixtures", "planning");

test("readState parses the frozen STATE.md fixture (STATE-01)", async () => {
  const s = await readState(fixturePlanning);
  assert.equal(s.current_phase, 1);
  assert.equal(s.total_phases, 7);
  assert.equal(s.current_phase_name, "Plugin Skeleton + De-Risk Vertical Slice");
  assert.ok(s.status, "status should be set");
  assert.ok(s.plan_raw && /of/.test(s.plan_raw), "plan_raw should carry the Plan line");
});

test("readState returns all-null for a missing STATE.md, never throws", async () => {
  const s = await readState(join(here, "..", "..", "test", "fixtures", "does-not-exist"));
  assert.equal(s.current_phase, null);
  assert.equal(s.total_phases, null);
  assert.equal(s.current_phase_name, null);
});
