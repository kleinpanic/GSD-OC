import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAgentOptional } from "../src/agents/index.js";
import { loadCorpus } from "../src/retrieval/corpus.js";
import { VERB_TO_SUBAGENT } from "../src/orchestrate/execute-path.js";

const corpus = loadCorpus();
const docIds = new Set<string>(corpus.docs.map((d: { id: string }) => d.id));
// top-level workflow command names (strip sub-modes/steps/templates like discuss-phase/modes/power)
const workflows = [...new Set(
  corpus.docs.filter((d: { id: string }) => d.id.startsWith("workflow:"))
    .map((d: { id: string }) => d.id.replace("workflow:", "").split("/")[0]),
)].sort() as string[];

/** gsd_command's resolution: a command is REACHABLE if it maps to a subagent OR a workflow doc exists for it. */
function reachable(cmd: string): boolean {
  if (VERB_TO_SUBAGENT[cmd]) return true;
  if (resolveAgentOptional(`gsd-${cmd}`) || resolveAgentOptional(cmd)) return true;
  return docIds.has(`workflow:${cmd}`);
}

test("CATALOG: the full GSD skill catalog is offered through the plugin (one tool: gsd_command)", () => {
  assert.ok(workflows.length >= 60, `expected the full catalog, got ${workflows.length}`);
  const unreachable = workflows.filter((w) => !reachable(w));
  assert.deepEqual(unreachable, [], `every skill must be reachable via gsd_command; unreachable: ${unreachable.join(", ")}`);
});

test("CATALOG: the upstream lifecycle categories are all present", () => {
  const has = (names: string[]) => names.every((n) => workflows.includes(n));
  // 6 — project & milestone lifecycle
  assert.ok(has(["new-project", "new-milestone", "complete-milestone", "plan-milestone-gaps", "milestone-summary", "transition"]), "lifecycle");
  // phase loop
  assert.ok(has(["discuss-phase", "plan-phase", "execute-phase", "verify-phase", "verify-work", "code-review", "secure-phase", "ui-phase", "ai-integration-phase"]), "phase loop");
  // context / codebase / docs
  assert.ok(has(["map-codebase", "docs-update", "ingest-docs", "explore", "analyze-dependencies"]), "context/docs");
  // ideation & design contracts
  assert.ok(has(["sketch", "spike", "plant-seed", "discovery-phase"]), "ideation");
  // shipping / workspace / state
  assert.ok(has(["ship", "pr-branch", "new-workspace", "list-workspaces", "next", "resume-project", "pause-work"]), "shipping/workspace/state");
  // config / meta / navigation
  assert.ok(has(["settings", "settings-advanced", "settings-integrations", "help", "progress", "stats", "manager", "profile-user"]), "config/meta/nav");
});

test("CATALOG: gsd_command resolves a representative live sample end-to-end", async () => {
  const mod = await import("../src/index.js");
  const tools: { name: string; execute: (id: string, a: unknown, s?: unknown) => Promise<{ ok: boolean; subagent: string | null; workflow: string | null }> }[] = [];
  (mod.default as { register: (api: unknown) => void }).register({
    registerService() {}, registerTool(t: never) { tools.push(t); }, registerCommand() {}, registerHook() {}, registerInternalHook() {},
    session: { state: { registerSessionExtension() {} } }, pluginConfig: {},
  });
  const cmd = tools.find((t) => t.name === "gsd_command")!;
  for (const c of ["code-review", "debug", "secure-phase", "docs-update", "verify-work", "roadmapper", "ship", "progress", "spike", "ui-phase", "plan-phase", "map-codebase"]) {
    const r = await cmd.execute("x", { command: c }, undefined);
    assert.ok(r.ok && (r.subagent || r.workflow), `gsd_command "${c}" resolved nothing`);
  }
});
