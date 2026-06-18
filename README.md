# gsd-oc

GSD (Get Shit Done) lifecycle orchestration as a **native OpenClaw plugin**.

GSD-OC brings the GSD methodology — research → codebase-map → plan → execute → verify →
ship — natively into OpenClaw for any OpenClaw agent. It auto-engages on coding/big work
(especially under `~/codeWS`), drives the ported GSD subagents in order **without the user
typing a single `/command`**, and runs decision gates as Discord-native interactions.

It is its own thing: **no Claude Code runtime dependency, no `@opengsd/*` dependency at
runtime, no ACP-into-Claude as the target.** The GSD state engine is reimplemented in
native TypeScript.

## Status

Phase 1 (de-risk vertical slice) — proves the integration spine: the plugin builds and
validates via the OpenClaw CLI, reads `.planning/` state natively, dispatches one subagent
by `agentId`, and fires an auto-engage prompt injection.

## Build & validate

```bash
npm install
npm run build                 # tsc -> dist/ (ESM)
npx openclaw plugins build    # generates openclaw.plugin.json
npx openclaw plugins validate # validates the manifest
npm test                      # node:test suite
```

## Operator configuration (required for auto-engage)

The auto-engage prompt injection uses the `before_prompt_build` hook. OpenClaw gates
prompt-mutating hooks for non-bundled plugins. To enable auto-engage, the **operator** must
set, in `~/.openclaw/openclaw.json`:

```jsonc
{
  "plugins": {
    "entries": {
      "gsd-oc": {
        "hooks": { "allowPromptInjection": true }
      }
    }
  }
}
```

> **This plugin never writes host configuration.** It only reads it via the SDK and
> documents the requirement here. `allowPromptInjection` gates `before_prompt_build`
> (the Phase-1 auto-engage seam). A later phase's auto-advance loop (`before_agent_finalize`)
> will additionally require `allowConversationAccess: true` — also operator-set.

## Opt-out

Auto-engage is gated to coding workspaces. To disable it for a project, the operator can
set `allowPromptInjection: false`. Per-project marker-file and session-toggle opt-outs land
in a later phase.

## License

MIT.
