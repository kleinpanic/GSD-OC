import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySurfaceProfile, readInstallProfile, resolveProfiledConfig, isSurfaceProfile } from "../src/engine/profile.js";
import { defaultGsdConfig } from "../src/engine/config.js";

test("surface profiles set coherent workflow blocks", () => {
  assert.ok(isSurfaceProfile("minimal") && isSurfaceProfile("full") && !isSurfaceProfile("xxx"));
  const min = applySurfaceProfile(defaultGsdConfig(), "minimal");
  assert.equal((min.workflow as Record<string, unknown>).code_review, false);
  assert.equal((min.workflow as Record<string, unknown>).skip_discuss, true);
  assert.equal((min.profiles as Record<string, unknown>).surface, "minimal");
  const full = applySurfaceProfile(defaultGsdConfig(), "full");
  assert.equal((full.workflow as Record<string, unknown>).security_asvs_level, 2);
  assert.equal((full.review as Record<string, unknown>).cross_ai_plan_review, true);
});

test("install profile (.gsd-profile) deep-merges over defaults; project config wins", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-prof-"));
  try {
    writeFileSync(join(d, ".gsd-profile"), JSON.stringify({ model_profile: "quality", git: { branching_strategy: "phase" } }));
    assert.equal(readInstallProfile(d)!.model_profile, "quality");
    const cfg = resolveProfiledConfig(d, { commit_docs: false });
    assert.equal(cfg.model_profile, "quality", "install profile applied");
    assert.equal((cfg.git as Record<string, unknown>).branching_strategy, "phase");
    assert.equal(cfg.commit_docs, false, "project config wins over profile");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("readInstallProfile: absent/garbage → null", () => {
  const d = mkdtempSync(join(tmpdir(), "gsd-prof-"));
  try {
    assert.equal(readInstallProfile(d), null);
    writeFileSync(join(d, ".gsd-profile"), "[1,2,3]");
    assert.equal(readInstallProfile(d), null, "non-object → null");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("gsd_settings profile op resolves a surface profile live", async () => {
  const mod = await import("../src/index.js");
  const tools: { name: string; execute: (id: string, a: unknown, s?: unknown) => Promise<{ surface?: string; workflow?: Record<string, unknown> }> }[] = [];
  (mod.default as { register: (api: unknown) => void }).register({ registerService() {}, registerTool(t: never) { tools.push(t); }, registerCommand() {}, registerHook() {}, registerInternalHook() {}, session: { state: { registerSessionExtension() {} } }, pluginConfig: {} });
  const settings = tools.find((t) => t.name === "gsd_settings")!;
  const r = await settings.execute("x", { profile: "minimal" }, undefined);
  assert.equal(r.surface, "minimal");
  assert.equal((r.workflow as Record<string, unknown>).code_review, false, "minimal surface disables code_review");
});
