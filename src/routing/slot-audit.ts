import fs from "node:fs";
import path from "node:path";
import entry from "../index.js";

/**
 * RTE-02 / RTE-03 / D-02: STRUCTURAL 0-slot proof (6-RESEARCH.md Pattern 3, :431-439; :148-157, :300).
 *
 * Only `registerCommand` projects a Discord global slash slot; `registerTool` registers agent
 * tools reachable via toolSearch (host-config, Tier 2) and consumes ZERO slots. This module
 * runs the plugin's `register(api)` against a spy api that counts each registration kind, and
 * cross-checks openclaw.plugin.json: it must declare `contracts.tools` (≥7) and NO `commands[]`.
 *
 * Combined verdict: globalSlashCommands(gsd-oc) === 0 ≤ 100 (RTE-03, 6-RESEARCH.md:113).
 */

export type SpyApi = {
  registerToolCalls: number;
  registerCommandCalls: number;
  registerServiceCalls: number;
  registerHookCalls: number;
  registerSessionExtensionCalls: number;
  registerInteractiveHandlerCalls: number;
  registerTool: (tool: unknown) => void;
  registerCommand: (cmd: unknown) => void;
  registerService: (svc: unknown) => void;
  registerHook: (name: unknown, handler: unknown) => void;
  registerInteractiveHandler: (reg: unknown) => void;
  pluginConfig?: Record<string, unknown>;
  session: { state: { registerSessionExtension: (ext: unknown) => void } };
};

/** A minimal spy api recording registration call counts; all registrations are no-ops. */
export function makeSpyApi(): SpyApi {
  const spy = {
    registerToolCalls: 0,
    registerCommandCalls: 0,
    registerServiceCalls: 0,
    registerHookCalls: 0,
    registerSessionExtensionCalls: 0,
    registerInteractiveHandlerCalls: 0,
    registerTool(_tool: unknown) {
      spy.registerToolCalls += 1;
    },
    registerCommand(_cmd: unknown) {
      spy.registerCommandCalls += 1;
    },
    registerService(_svc: unknown) {
      spy.registerServiceCalls += 1;
    },
    registerHook(_name: unknown, _handler: unknown) {
      spy.registerHookCalls += 1;
    },
    registerInteractiveHandler(_reg: unknown) {
      spy.registerInteractiveHandlerCalls += 1;
    },
    session: {
      state: {
        registerSessionExtension(_ext: unknown) {
          spy.registerSessionExtensionCalls += 1;
        },
      },
    },
  };
  return spy;
}

export type SlotAudit = {
  registerToolCalls: number;
  registerCommandCalls: number;
  manifestCommandCount: number;
  manifestToolCount: number;
};

/** Read the manifest's command/tool surface as declared in openclaw.plugin.json. */
function readManifestSurface(manifestPath: string): { commands: number; tools: number } {
  const raw = fs.readFileSync(path.resolve(manifestPath), "utf8");
  const manifest = JSON.parse(raw) as {
    commands?: unknown[];
    contracts?: { tools?: unknown[] };
  };
  const commands = Array.isArray(manifest.commands) ? manifest.commands.length : 0;
  const tools = Array.isArray(manifest.contracts?.tools) ? manifest.contracts!.tools!.length : 0;
  return { commands, tools };
}

/**
 * Audit the plugin's registration surface offline: run register() against a spy api and parse
 * the manifest. Reuses the default plugin entry (../index.js) — no duplicated registration logic.
 */
export function auditSlots(manifestPath = "openclaw.plugin.json"): SlotAudit {
  const spy = makeSpyApi();
  entry.register(spy as never);
  const { commands, tools } = readManifestSurface(manifestPath);
  return {
    registerToolCalls: spy.registerToolCalls,
    registerCommandCalls: spy.registerCommandCalls,
    manifestCommandCount: commands,
    manifestToolCount: tools,
  };
}

/**
 * WR-01: enforce the 0-slot invariant. `auditSlots` only REPORTS the surface; callers
 * (CI / startup) call this to FAIL when any Discord global slash slot would be consumed —
 * either via a manifest `commands[]` entry or a runtime `registerCommand` call.
 */
export function assertZeroSlots(audit: SlotAudit): void {
  if (audit.manifestCommandCount > 0 || audit.registerCommandCalls > 0) {
    throw new Error(
      `0-slot invariant violated: manifestCommandCount=${audit.manifestCommandCount}, ` +
        `registerCommandCalls=${audit.registerCommandCalls} (both must be 0)`,
    );
  }
}
