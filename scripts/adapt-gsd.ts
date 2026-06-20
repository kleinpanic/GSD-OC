/**
 * PORT-01: build-time adaptation transform. The snapshotted GSD docs are written FOR Claude Code — they
 * tell the agent to read `$HOME/.claude/gsd-core/...` files and shell the `gsd-tools` CLI. Neither exists
 * in an OpenClaw runtime: the docs/templates/references/agents are BUNDLED in this plugin's corpus
 * (retrievable via gsd_retrieve), and state/commit/etc. are handled by the gsd-oc native engine. This
 * transform rewrites those Claude-runtime assumptions into runtime-agnostic language so a ported persona
 * never instructs an OpenClaw agent to read a Claude dir or run a CLI it doesn't have.
 *
 * Applied to every corpus doc (scripts/build-corpus.ts) and every ported persona (scripts/port-agents.ts).
 */

export function adaptGsdText(text: string): string {
  let t = text;

  // 1. Bundled GSD reference/template/agent/workflow file refs → retrievable bundled-data language.
  t = t.replace(/@?\$HOME\/\.claude\/gsd-core\/references\/([\w./-]+?)\.md/g, "the bundled GSD reference `reference:$1` (retrieve via gsd_retrieve)");
  t = t.replace(/@?\$HOME\/\.claude\/gsd-core\/templates\/([\w./-]+?)\.md/g, "the bundled GSD template `template:$1`");
  t = t.replace(/@?\$HOME\/\.claude\/gsd-core\/workflows\/([\w./-]+?)\.md/g, "the bundled GSD workflow `workflow:$1`");
  t = t.replace(/@?\$HOME\/\.claude\/agents\/(gsd-[\w-]+)\.md/g, "the bundled GSD subagent `$1`");

  // 2. Claude-Code CLI binaries / gsd-core bin → the native engine (no shelling).
  t = t.replace(/@?\$HOME\/\.claude\/(gsd-core\/)?bin\/[\w./-]+/g, "the gsd-oc native engine");

  // 3. Any remaining ~/.claude or $HOME/.claude path → neutral bundled-data root (with OR without a
  //    trailing slash, e.g. a bare `configDir = $HOME/.claude`).
  t = t.replace(/@?\$HOME\/\.claude(\/)?/g, "<gsd-bundled>$1");
  t = t.replace(/@?~\/\.claude(\/)?/g, "<gsd-bundled>$1");

  // 4. gsd-tools CLI invocations → the native engine (the gsd-oc plugin reimplements state/commit/etc.;
  //    R0.3 forbids shelling gsd-tools). Keep the verb so the intent is preserved, drop the CLI framing.
  t = t.replace(/`?gsd-tools\s+query\s+([\w.-]+)`?/g, "the gsd-oc native engine (`$1`)");
  t = t.replace(/`?gsd-tools(\.cjs)?`?/g, "the gsd-oc native engine");

  // 5. Runtime-name agnosticism — these docs are now driven by OpenClaw agents, not Claude Code.
  t = t.replace(/Claude Code/g, "the OpenClaw agent");
  t = t.replace(/claude-code/g, "openclaw");
  t = t.replace(/claude code/g, "the openclaw agent");

  return t;
}

/** True iff the text still carries a Claude-runtime assumption the transform should have removed. */
export function hasClaudeRuntimeRef(text: string): boolean {
  return /\$HOME\/\.claude\/|~\/\.claude\/|gsd-tools|Claude Code|claude-code/.test(text);
}
