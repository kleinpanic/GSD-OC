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

  // 2. Claude-Code CLI binaries / gsd-core bin → a SHELL-SAFE identifier (no spaces — a prose phrase here
  //    corrupted a bash shim, e.g. `command -v <phrase>`). `gsd-oc-engine` is valid in both code and prose.
  t = t.replace(/@?\$HOME\/\.claude\/(gsd-core\/)?bin\/[\w./-]+/g, "gsd-oc-engine");

  // 3. Any remaining .claude path → neutral bundled-data root. Handle $HOME/, ~/, AND a BARE `.claude/`
  //    (the prior transform missed `.claude/skills/`, `.claude/gsd-core` — 21 refs survived).
  t = t.replace(/@?\$HOME\/\.claude(\/)?/g, "<gsd-bundled>$1");
  t = t.replace(/@?~\/\.claude(\/)?/g, "<gsd-bundled>$1");
  t = t.replace(/(?<!\w)\.claude(\/)/g, "<gsd-bundled>$1");

  // 4. gsd-tools CLI → shell-safe `gsd-oc-engine` (NOT a spaced phrase: `_GSD_SHIM_NAME="gsd-tools.cjs"`
  //    must not become a multi-word string). Keep the query verb as a trailing note where present.
  t = t.replace(/`?gsd-tools(?:\.cjs)?\s+query\s+([\w.-]+)`?/g, "gsd-oc-engine ($1)");
  t = t.replace(/`?gsd-tools(?:\.cjs)?`?/g, "gsd-oc-engine");

  // 5. Runtime-name agnosticism — these docs are driven by OpenClaw agents, not Claude Code.
  t = t.replace(/Claude Code/g, "the OpenClaw agent");
  t = t.replace(/claude-code/g, "openclaw");
  t = t.replace(/claude code/g, "the openclaw agent");

  return t;
}

/** True iff the text still carries a Claude-runtime assumption the transform should have removed.
 *  Includes a BARE `.claude/` (not just $HOME/~) so PORT-02 catches `.claude/skills/` etc. */
export function hasClaudeRuntimeRef(text: string): boolean {
  // WARNING fix: `.claude` followed by ANY non-word char (path sep `/`, `\`, `;`, backtick, space, EOL) — the old
  // `\.claude\/` only caught a forward slash and missed `.claude\tasks`, `.claude;`, etc. The `(?<!\w)` lookbehind
  // still excludes the legitimate `review.models.claude` reviewer-config key (a word char precedes that dot).
  return /(?<!\w)\.claude(?!\w)|\$HOME\/\.claude|~\/\.claude|gsd-tools|Claude Code|claude-code/.test(text);
}
