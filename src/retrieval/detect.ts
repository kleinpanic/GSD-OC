/**
 * Multi-CLI GSD install detection (RET-01). Snapshots from the *detected* GSD
 * install wherever it lives across agentic-CLI homes (claude/codex/opencode/
 * gemini/pi/hermes/cursor/copilot), never reading sensitive home files. The
 * detection walker enforces a deny-list (defense-in-depth) on top of the
 * allow-listed doc roots. Used by scripts/build-corpus.ts (dev-time only).
 */
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GsdDocKind } from "./types.js";

export interface DetectedInstall {
  cli: string;
  root: string;
  docRoots: { kind: GsdDocKind; root: string; recursive: boolean }[];
}

export const DENY: { dirs: Set<string>; globs: RegExp[] } = {
  dirs: new Set([
    ".ssh",
    ".gnupg",
    ".aws",
    ".netrc",
    ".Xauthority",
    ".git",
    ".env",
    "id_rsa",
    "id_ed25519",
    ".bash_history",
    ".zsh_history",
    "credentials",
    ".npmrc",
    ".config",
  ]),
  globs: [/^\.env\..+$/, /\.pem$/, /\.key$/, /_history$/],
};

export function isDenied(name: string): boolean {
  if (DENY.dirs.has(name)) return true;
  return DENY.globs.some((re) => re.test(name));
}

interface Candidate {
  cli: string;
  root: string;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function candidateRoots(env: NodeJS.ProcessEnv = process.env, home = homedir()): Candidate[] {
  const xdg = env.XDG_CONFIG_HOME || join(home, ".config");
  const rows: Candidate[] = [
    { cli: "claude", root: join(home, ".claude") },
    { cli: "codex", root: env.CODEX_HOME || join(home, ".codex") },
    { cli: "opencode", root: env.OPENCODE_CONFIG_DIR || join(xdg, "opencode") },
    { cli: "gemini", root: env.GEMINI_CONFIG_DIR || join(home, ".gemini") },
    { cli: "pi", root: join(home, ".pi") },
    { cli: "hermes", root: env.HERMES_HOME || join(home, ".hermes") },
    { cli: "cursor", root: env.CURSOR_CONFIG_DIR || join(home, ".cursor") },
    { cli: "copilot", root: env.COPILOT_CONFIG_DIR || join(home, ".copilot") },
  ];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const r of rows) {
    if (seen.has(r.root)) continue;
    seen.add(r.root);
    out.push(r);
  }
  return out;
}

function resolveDocRoots(root: string): DetectedInstall["docRoots"] {
  const core = join(root, "gsd-core");
  const agentsSibling = join(root, "agents");
  const agentsCore = join(core, "agents");
  const agents = isDir(agentsSibling) ? agentsSibling : agentsCore;
  return [
    { kind: "workflow", root: join(core, "workflows"), recursive: false },
    { kind: "agent", root: agents, recursive: false },
    { kind: "reference", root: join(core, "references"), recursive: false },
    { kind: "template", root: join(core, "templates"), recursive: true },
  ];
}

export function detectGsdInstall(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): DetectedInstall | null {
  for (const c of candidateRoots(env, home)) {
    if (isDir(join(c.root, "gsd-core", "workflows"))) {
      return { cli: c.cli, root: c.root, docRoots: resolveDocRoots(c.root) };
    }
  }
  return null;
}

export function safeList(root: string, recursive: boolean): string[] {
  let ents;
  try {
    ents = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of ents) {
    if (isDenied(e.name)) continue;
    const full = join(root, e.name);
    if (e.isDirectory()) {
      if (recursive) out.push(...safeList(full, true));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out.sort();
}
