import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeSpyApi, auditSlots, assertZeroSlots } from "../src/routing/slot-audit.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = join(here, "..", "..", "openclaw.plugin.json");

// RTE-03 deterministic offline 0-slot proof (6-RESEARCH.md Pattern 3, :431-439). No gateway.

test("spy api records registerCommand === 0 and registerTool >= 7 (RTE-02/03, D-02)", () => {
  const audit = auditSlots(manifest);
  assert.equal(audit.registerCommandCalls, 0, "plugin registers ZERO slash commands");
  assert.ok(audit.registerToolCalls >= 7, `registerTool >= 7 (got ${audit.registerToolCalls})`);
  assert.ok(audit.registerToolCalls <= 100, "registerTool within Discord 100-command cap");
});

test("manifest declares no commands[] and contracts.tools >= 7 (artifact-level 0-slot)", () => {
  const audit = auditSlots(manifest);
  assert.equal(audit.manifestCommandCount, 0, "manifest commands[] absent/empty");
  assert.ok(audit.manifestToolCount >= 7, `contracts.tools >= 7 (got ${audit.manifestToolCount})`);
});

test("combined verdict: globalSlashCommands(gsd-oc) === 0 <= 100 (RTE-03 success criterion)", () => {
  const audit = auditSlots(manifest);
  const globalSlashCommands = audit.registerCommandCalls + audit.manifestCommandCount;
  assert.equal(globalSlashCommands, 0);
  assert.ok(globalSlashCommands <= 100);
});

// ── WR-01 (MT-01): assertZeroSlots enforces the invariant auditSlots only reports ──

test("MT-01: auditSlots counts a synthetic manifest's commands; assertZeroSlots throws on >0", () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "slot-audit-"));
  const synthetic = join(dir, "openclaw.plugin.json");
  fs.writeFileSync(
    synthetic,
    JSON.stringify({
      contracts: { tools: ["a", "b", "c", "d", "e", "f", "g"] },
      commands: [{ name: "x" }, { name: "y" }],
    }),
  );
  try {
    const audit = auditSlots(synthetic);
    assert.equal(audit.manifestCommandCount, 2, "two synthetic commands counted");
    assert.equal(audit.manifestToolCount, 7);
    assert.throws(
      () => assertZeroSlots(audit),
      /0-slot invariant violated/,
      "a manifest with commands[] must fail the invariant",
    );
    // A clean audit (no commands, no registerCommand calls) must NOT throw.
    assert.doesNotThrow(() =>
      assertZeroSlots({
        registerToolCalls: 7,
        registerCommandCalls: 0,
        manifestCommandCount: 0,
        manifestToolCount: 7,
      }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("makeSpyApi counts each registration kind independently", () => {
  const spy = makeSpyApi();
  spy.registerTool({});
  spy.registerTool({});
  spy.registerService({});
  spy.session.state.registerSessionExtension({});
  assert.equal(spy.registerToolCalls, 2);
  assert.equal(spy.registerCommandCalls, 0);
  assert.equal(spy.registerServiceCalls, 1);
  assert.equal(spy.registerSessionExtensionCalls, 1);
});
