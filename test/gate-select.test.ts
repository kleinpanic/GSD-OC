import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectGate, MultiPickNotSupportedError } from "../src/gates/build-select.js";
import type { GsdGate } from "../src/gates/types.js";

test("buildSelectGate emits a single-select block with callback option values (GATE-02)", () => {
  const gate: GsdGate = {
    id: "g2",
    kind: "select",
    title: "Pick a phase",
    placeholder: "Choose…",
    choices: [
      { id: "p1", label: "Phase 1" },
      { id: "p2", label: "Phase 2" },
    ],
  };
  const p = buildSelectGate(gate);
  assert.deepEqual(p, {
    title: "Pick a phase",
    tone: "info",
    blocks: [
      {
        type: "select",
        placeholder: "Choose…",
        options: [
          { label: "Phase 1", action: { type: "callback", value: "g2:p1" } },
          { label: "Phase 2", action: { type: "callback", value: "g2:p2" } },
        ],
      },
    ],
  });
});

test("buildSelectGate omits placeholder when absent", () => {
  const p = buildSelectGate({
    id: "g3",
    kind: "select",
    title: "T",
    choices: [{ id: "x", label: "X" }],
  });
  const block = p.blocks[0] as Record<string, unknown>;
  assert.equal("placeholder" in block, false);
});

test("buildSelectGate rejects multi-pick gates with a typed error (Pitfall 3 → route to poll)", () => {
  const gate: GsdGate = {
    id: "g4",
    kind: "select",
    title: "Pick many",
    multi: true,
    choices: [{ id: "a", label: "A" }],
  };
  assert.throws(() => buildSelectGate(gate), MultiPickNotSupportedError);
  assert.throws(() => buildSelectGate(gate), /portable select is single-only/);
});
