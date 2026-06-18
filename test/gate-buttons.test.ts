import { test } from "node:test";
import assert from "node:assert/strict";
import { buildButtonsGate } from "../src/gates/build-buttons.js";
import type { GsdGate } from "../src/gates/types.js";

test("buildButtonsGate emits portable buttons with callback values '<gateId>:<choiceId>' (GATE-01)", () => {
  const gate: GsdGate = {
    id: "g1",
    kind: "binary",
    title: "Approve?",
    choices: [
      { id: "yes", label: "Yes", style: "success" },
      { id: "no", label: "No", style: "danger" },
    ],
  };
  const p = buildButtonsGate(gate);
  assert.deepEqual(p, {
    title: "Approve?",
    tone: "info",
    blocks: [
      {
        type: "buttons",
        buttons: [
          { label: "Yes", style: "success", action: { type: "callback", value: "g1:yes" } },
          { label: "No", style: "danger", action: { type: "callback", value: "g1:no" } },
        ],
      },
    ],
  });
});

test("buildButtonsGate omits style when a choice has none", () => {
  const p = buildButtonsGate({
    id: "g9",
    kind: "binary",
    title: "Pick",
    choices: [{ id: "a", label: "A" }],
  });
  const btn = (p.blocks[0] as { buttons: Array<Record<string, unknown>> }).buttons[0];
  assert.equal("style" in btn, false);
  assert.deepEqual(btn.action, { type: "callback", value: "g9:a" });
});
