import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPollSpec, validatePollSpec } from "../src/gates/build-poll.js";
import { buildSelectGate, MultiPickNotSupportedError } from "../src/gates/build-select.js";
import type { GsdGate } from "../src/gates/types.js";

const rankGate: GsdGate = {
  id: "g2",
  kind: "poll",
  title: "Rank options",
  multi: true,
  choices: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
};

test("buildPollSpec maps a multi-pick gate to a PollInput with resolved maxSelections (GATE-04)", () => {
  const spec = buildPollSpec(rankGate);
  assert.equal(spec.question, "Rank options");
  assert.deepEqual(spec.options, ["A", "B", "C"]);
  // multi → resolvePollMaxSelections returns the option count.
  assert.equal(spec.maxSelections, 3);
});

test("buildPollSpec single-pick resolves maxSelections to 1", () => {
  const spec = buildPollSpec({ ...rankGate, multi: false });
  assert.equal(spec.maxSelections, 1);
});

test("normalizePollInput(buildPollSpec(gate)) succeeds — maxSelections stays in range", () => {
  const normalized = validatePollSpec(buildPollSpec(rankGate));
  assert.equal(normalized.question, "Rank options");
  assert.equal(normalized.maxSelections, 3);
  assert.ok(normalized.maxSelections <= normalized.options.length);
});

test("validatePollSpec rejects an out-of-range maxSelections (range guard)", () => {
  assert.throws(() => validatePollSpec({ question: "Q", options: ["A", "B"], maxSelections: 99 }));
});

test("a multi-pick GsdGate rejected by build-select maps cleanly through buildPollSpec", () => {
  assert.throws(() => buildSelectGate(rankGate), MultiPickNotSupportedError);
  const spec = buildPollSpec(rankGate);
  assert.doesNotThrow(() => validatePollSpec(spec));
});
