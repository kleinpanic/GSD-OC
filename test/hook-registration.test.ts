import { test } from "node:test";
import assert from "node:assert/strict";
import entry from "../src/index.js";

/**
 * Regression for the real bug a live `openclaw plugins install` surfaced (unit mocks +
 * `openclaw plugins validate` did NOT catch it): the runtime registry requires `opts.name`
 * on every registerHook call (registry-B8gzOJBq.js:3082 — "hook registration missing name").
 * This test runs the actual register() with a recording api and asserts every hook
 * registration carries a non-empty name.
 */
test("every registerHook call passes a non-empty opts.name (live-install regression)", () => {
  const hookRegs: Array<{ events: unknown; opts: unknown }> = [];
  const api = {
    registerService() {},
    registerTool() {},
    registerHook(events: unknown, _handler: unknown, opts?: unknown) {
      hookRegs.push({ events, opts });
    },
    registerInteractiveHandler() {},
    pluginConfig: {},
    session: { state: { registerSessionExtension() {} } },
  };

  // definePluginEntry returns an object whose register(api) wires the hooks.
  (entry as unknown as { register: (a: unknown) => void }).register(api);

  assert.ok(hookRegs.length >= 2, "expected at least the auto-engage + auto-advance hooks");
  for (const reg of hookRegs) {
    const name = (reg.opts as { name?: string } | undefined)?.name;
    assert.ok(
      typeof name === "string" && name.trim().length > 0,
      `registerHook(${JSON.stringify(reg.events)}) missing required opts.name`,
    );
  }
});
