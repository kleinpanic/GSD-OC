import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptGsdText, hasClaudeRuntimeRef } from "../scripts/adapt-gsd.js";
import { loadCorpus } from "../src/retrieval/corpus.js";
import { ROSTER } from "../src/agents/roster.generated.js";

test("PORT-01: rewrites ~/.claude reference/template/agent paths to bundled language", () => {
  assert.match(adaptGsdText("@$HOME/.claude/gsd-core/references/gate-prompts.md"), /bundled GSD reference `reference:gate-prompts`/);
  assert.match(adaptGsdText("$HOME/.claude/gsd-core/templates/AI-SPEC.md"), /bundled GSD template `template:AI-SPEC`/);
  assert.match(adaptGsdText("$HOME/.claude/agents/gsd-eval-planner.md"), /bundled GSD subagent `gsd-eval-planner`/);
  assert.match(adaptGsdText("$HOME/.claude/gsd-core/workflows/plan-phase.md"), /bundled GSD workflow `workflow:plan-phase`/);
});

test("PORT-01: neutralizes gsd-tools CLI + bin paths + a bare $HOME/.claude", () => {
  assert.match(adaptGsdText("gsd-tools query commit --files x"), /gsd-oc native engine \(`commit`\)/);
  assert.match(adaptGsdText("$HOME/.claude/gsd-core/bin/lib/ui-safety-gate.cjs"), /gsd-oc native engine/);
  assert.equal(/\$HOME\/\.claude/.test(adaptGsdText("configDir = $HOME/.claude")), false);
  assert.match(adaptGsdText("Claude Code drives this"), /the OpenClaw agent drives this/);
});

test("PORT-01: adapted text carries NO Claude-runtime reference", () => {
  const samples = [
    "@$HOME/.claude/gsd-core/references/x.md and run gsd-tools query state.load",
    "read ~/.claude/agents/gsd-planner.md (Claude Code)",
    "configDir = $HOME/.claude → checks $HOME/.claude/hooks/",
  ];
  for (const s of samples) assert.equal(hasClaudeRuntimeRef(adaptGsdText(s)), false, `still has ref: ${s}`);
});

test("PORT-02: the GENERATED corpus has zero Claude-runtime references", () => {
  const corpus = loadCorpus();
  const dirty = corpus.docs.filter((d) => /\$HOME\/\.claude\/|~\/\.claude\/|gsd-tools|Claude Code/.test(d.text));
  assert.equal(dirty.length, 0, `corpus docs still Claude-specific: ${dirty.slice(0, 3).map((d) => d.id).join(", ")}`);
});

test("PORT-02: the ported personas (ROSTER) carry no Claude-runtime references", () => {
  const dirty = ROSTER.filter((a) => /\$HOME\/\.claude\/|~\/\.claude\/|gsd-tools|Claude Code/.test(a.prompt));
  assert.equal(dirty.length, 0, `personas still Claude-specific: ${dirty.map((a) => a.id).join(", ")}`);
});
