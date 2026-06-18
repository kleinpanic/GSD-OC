import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseGateCallback,
  validateGateChoice,
  buildGateResumeText,
  registerGateInteractiveHandler,
  encodeGateCallback,
  GateCallbackParseError,
} from "../src/gates/resume.js";
import { buildButtonsGate } from "../src/gates/build-buttons.js";
import { buildSelectGate } from "../src/gates/build-select.js";
import type { NextTurnInjectionApi } from "../src/orchestrate/inject.js";
import type { GsdGate } from "../src/gates/types.js";

const here = dirname(fileURLToPath(import.meta.url));

const pending: GsdGate = {
  id: "g1",
  kind: "binary",
  title: "Approve?",
  choices: [
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
  ],
};

function mockApi(): { api: NextTurnInjectionApi; calls: unknown[] } {
  const calls: unknown[] = [];
  const api: NextTurnInjectionApi = {
    session: {
      workflow: {
        async enqueueNextTurnInjection(inj) {
          calls.push(inj);
          return { enqueued: true, id: "inj-1", sessionKey: inj.sessionKey };
        },
      },
    },
  };
  return { api, calls };
}

// ── parseGateCallback: three valid shapes ──

test("parseGateCallback: string shape", () => {
  assert.deepEqual(parseGateCallback("g1:yes"), { gateId: "g1", choice: "yes" });
});

test("parseGateCallback: {value} shape (MessagePresentation callback)", () => {
  assert.deepEqual(parseGateCallback({ value: "g1:yes" }), { gateId: "g1", choice: "yes" });
});

test("parseGateCallback: {data:{custom_id}} shape (Discord-native interaction)", () => {
  assert.deepEqual(parseGateCallback({ data: { custom_id: "g1:yes" } }), { gateId: "g1", choice: "yes" });
});

// ── parseGateCallback: defensive throws (ctx unknown — OR-G5a) ──

test("parseGateCallback: throws on null / {} / {value:42} / no-colon", () => {
  assert.throws(() => parseGateCallback(null), GateCallbackParseError);
  assert.throws(() => parseGateCallback({}), GateCallbackParseError);
  assert.throws(() => parseGateCallback({ value: 42 }), GateCallbackParseError);
  assert.throws(() => parseGateCallback("no-colon"), GateCallbackParseError);
  assert.throws(() => parseGateCallback(":leadingcolon"), GateCallbackParseError);
});

// ── validateGateChoice: default-deny ──

test("validateGateChoice: accepts known gate+choice, rejects unknown", () => {
  assert.equal(validateGateChoice(pending, "g1", "yes"), true);
  assert.equal(validateGateChoice(pending, "g1", "maybe"), false);
  assert.equal(validateGateChoice(pending, "other", "yes"), false);
});

test("buildGateResumeText: bounded, names only gateId+choice, no .planning bodies", () => {
  const text = buildGateResumeText("g1", "yes");
  assert.match(text, /g1/);
  assert.match(text, /yes/);
  assert.doesNotMatch(text, /\.planning\//);
});

// ── handler: keyed enqueue on valid, no enqueue on invalid ──

test("handler enqueues keyed injection on a VALID interaction (idempotencyKey gsd:gate:g1)", async () => {
  const { api, calls } = mockApi();
  const reg = registerGateInteractiveHandler({ api, sessionKey: "sk", pending });
  assert.equal(reg.channel, "discord");
  assert.equal(reg.namespace, "gsd-gate");
  const res = await reg.handler({ data: { custom_id: "g1:yes" } });
  assert.deepEqual(res, { handled: true });
  assert.equal(calls.length, 1);
  const inj = calls[0] as { sessionKey: string; idempotencyKey?: string; placement?: string; text: string };
  assert.equal(inj.sessionKey, "sk");
  assert.equal(inj.idempotencyKey, "gsd:gate:g1");
  assert.equal(inj.placement, "prepend_context");
  assert.match(inj.text, /g1/);
});

test("handler does NOT enqueue on an INVALID interaction (default-deny)", async () => {
  const { api, calls } = mockApi();
  const reg = registerGateInteractiveHandler({ api, sessionKey: "sk", pending });
  assert.deepEqual(await reg.handler({ value: "g1:maybe" }), { handled: false });
  assert.deepEqual(await reg.handler(null), { handled: false });
  assert.deepEqual(await reg.handler({ value: "other:yes" }), { handled: false });
  assert.equal(calls.length, 0);
});

// ── M-04: colon-in-id codec contract (builder + parser agree) ──

test("M-04: encodeGateCallback round-trips through parseGateCallback for colon-free ids", () => {
  const value = encodeGateCallback("g1", "yes");
  assert.equal(value, "g1:yes");
  assert.deepEqual(parseGateCallback(value), { gateId: "g1", choice: "yes" });
});

test("M-04: a colon in gate.id is rejected at build time (no silent default-deny)", () => {
  const gate: GsdGate = {
    id: "phase:2",
    kind: "binary",
    title: "Approve?",
    choices: [{ id: "yes", label: "Yes" }],
  };
  // Pre-fix: builder emitted "phase:2:yes", parser split on the first colon →
  // gateId "phase", choice "2:yes" → validateGateChoice default-denies a valid
  // click and the gate stalls. Now the colon is rejected loudly at encode time.
  assert.throws(() => buildButtonsGate(gate), GateCallbackParseError);
  assert.throws(() => buildSelectGate(gate), GateCallbackParseError);
  assert.throws(() => encodeGateCallback("phase:2", "yes"), GateCallbackParseError);
});

test("M-04: a colon in choice.id is rejected at build time", () => {
  const gate: GsdGate = {
    id: "g1",
    kind: "select",
    title: "Pick",
    choices: [{ id: "a:b", label: "A" }],
  };
  assert.throws(() => buildSelectGate(gate), GateCallbackParseError);
  assert.throws(() => encodeGateCallback("g1", "a:b"), GateCallbackParseError);
});

test("resume.ts NEVER imports setWaiting/managedFlows (Pitfall 2)", () => {
  const src = readFileSync(join(here, "..", "..", "src", "gates", "resume.ts"), "utf8");
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
    .join("\n");
  assert.doesNotMatch(code, /setWaiting/);
  assert.doesNotMatch(code, /managedFlows/);
});
