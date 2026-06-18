import { isCodingWorkspace } from "../hooks/auto-engage.js";
import { optedOut } from "./opt-out.js";
import { gsdAgentsSection } from "./agents-md.js";

/**
 * R0.5 auto-engage — the CANONICAL, robust delivery (supersedes the dead `before_prompt_build`
 * hook AND the static on-disk AGENTS.md append).
 *
 * The `agent:bootstrap` internal hook fires on the embedded/gateway agent path
 * [selection-kQiC501t.js:11980/12002 → bootstrap-files-B1di_awi.js:15-29] and hands the handler
 * a MUTABLE `bootstrapFiles[]`. Unlike `before_prompt_build`, this hook is backed by
 * `globalThis[Symbol.for("openclaw.internalHookHandlers")]` — the SAME runner the agent runtime
 * consults — so it is not wiped by the per-load hook-runner re-init (loader-B5_7jXkx.js:1420).
 *
 * AGENTS is the order-10 bootstrap file (system-prompt-config-Bg4kQKen.js:70-77) and the only one
 * that survives subagent filtering, so we own its content with policy-shaped imperative lines that
 * lead the seeded persona (SOUL/IDENTITY at order 20/30).
 */

/** Minimal structural view of the agent:bootstrap event (internal-hooks-q1e-n9BY.d.ts:8-19). */
export type WorkspaceBootstrapFile = {
  name: string;
  path: string;
  content?: string;
  missing: boolean;
};
export type AgentBootstrapContext = {
  workspaceDir: string;
  bootstrapFiles: WorkspaceBootstrapFile[];
  cfg?: { plugins?: { entries?: Record<string, { config?: Record<string, unknown> }> } };
  sessionKey?: string;
  agentId?: string;
};
export type AgentBootstrapEvent = { context: AgentBootstrapContext };

/** A bootstrap file is the AGENTS persona if named AGENTS or its path ends with AGENTS.md. */
function isAgentsFile(f: WorkspaceBootstrapFile): boolean {
  return f.name === "AGENTS" || /(^|\/)AGENTS\.md$/i.test(f.path);
}

/** True once the GSD managed block is present in `content`. */
function alreadyInjected(content: string | undefined): boolean {
  return !!content && content.includes("gsd-oc:begin");
}

/** Read the operator opt-out flag (c) from the bootstrap event's full config, if present. */
function pluginConfigFrom(ctx: AgentBootstrapContext): Record<string, unknown> | undefined {
  return ctx.cfg?.plugins?.entries?.["gsd-oc"]?.config;
}

/**
 * Pure decision: given the bootstrap context, return the AGENTS content to set (GSD section
 * leading any existing content), or null to leave bootstrapFiles untouched (not a coding
 * workspace, or opted out).
 */
export function decideBootstrapInjection(ctx: AgentBootstrapContext): {
  index: number;
  content: string;
} | null {
  if (!isCodingWorkspace(ctx.workspaceDir)) return null;
  if (optedOut({ cwd: ctx.workspaceDir, pluginConfig: pluginConfigFrom(ctx) })) return null;

  const idx = ctx.bootstrapFiles.findIndex(isAgentsFile);
  const section = gsdAgentsSection();
  if (idx === -1) {
    // No AGENTS entry present — synthesize one so the GSD policy still leads.
    return { index: -1, content: `# AGENTS.md\n\n${section}\n` };
  }
  const existing = ctx.bootstrapFiles[idx].content ?? "";
  if (alreadyInjected(existing)) return null; // idempotent — don't double-inject
  // Lead the seeded AGENTS content with the GSD policy block.
  const merged = existing.trim() === "" ? `${section}\n` : `${section}\n\n${existing}`;
  return { index: idx, content: merged };
}

/**
 * `agent:bootstrap` handler. Mutates `event.context.bootstrapFiles` in place (the runtime reads
 * it back — bootstrap-files-B1di_awi.js:27). Narrowed defensively without importing the SDK's
 * `isAgentBootstrapEvent` to keep this module unit-testable in isolation; index.ts gates with the
 * real `isAgentBootstrapEvent`.
 */
export function gsdBootstrapHandler(event: AgentBootstrapEvent): void {
  const ctx = event?.context;
  if (!ctx || !Array.isArray(ctx.bootstrapFiles) || typeof ctx.workspaceDir !== "string") return;
  const decision = decideBootstrapInjection(ctx);
  if (!decision) return;
  if (decision.index === -1) {
    ctx.bootstrapFiles.unshift({
      name: "AGENTS",
      path: `${ctx.workspaceDir}/AGENTS.md`,
      content: decision.content,
      missing: false,
    });
  } else {
    ctx.bootstrapFiles[decision.index] = {
      ...ctx.bootstrapFiles[decision.index],
      content: decision.content,
      missing: false,
    };
  }
}
