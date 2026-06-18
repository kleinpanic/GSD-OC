import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFreeTextFallback } from "../src/gates/build-modal.js";
import type { GsdGate } from "../src/gates/types.js";

test("buildFreeTextFallback emits a portable text presentation (GATE-03)", () => {
  const gate: GsdGate = {
    id: "g3",
    kind: "free-text",
    title: "Describe the bug",
    prompt: "Enter details",
  };
  const p = buildFreeTextFallback(gate);
  assert.deepEqual(p, {
    title: "Describe the bug",
    tone: "info",
    blocks: [
      { type: "text", text: "Enter details" },
      {
        type: "context",
        text: "Free-text fallback — a native Discord modal is gateway-gated (Phase 7).",
      },
    ],
  });
});

test("buildFreeTextFallback defaults the prompt when absent", () => {
  const p = buildFreeTextFallback({ id: "g8", kind: "free-text", title: "T" });
  assert.equal((p.blocks[0] as { text: string }).text, "Reply with your input.");
});

test("free-text fallback does NOT depend on the deprecated modal facade (no untyped modal blob)", () => {
  const p = buildFreeTextFallback({ id: "g3", kind: "free-text", title: "T", prompt: "x" });
  const serialized = JSON.stringify(p);
  // No `modal` key anywhere in the produced presentation (Pitfall 4 / T-06-05).
  assert.doesNotMatch(serialized, /"modal"/);
  // Only portable block types are emitted.
  for (const b of p.blocks) {
    assert.ok(["text", "context", "divider", "buttons", "select"].includes((b as { type: string }).type));
  }
});
