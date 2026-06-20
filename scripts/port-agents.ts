/**
 * Dev-time generator (NOT a runtime dependency — RESEARCH Q5): parses the 33
 * ~/.claude/agents/gsd-*.md source agents and emits the committed
 * src/agents/roster.generated.ts so the roster ships inlined in `dist` with no
 * runtime filesystem read.
 *
 * Run:  node --experimental-strip-types scripts/port-agents.ts
 *
 * Handles BOTH YAML `tools:` forms: CSV (31 agents) and block-list (2 agents —
 * gsd-security-auditor, gsd-nyquist-auditor). Maps CC tool names → OpenClaw ids via
 * CC_TO_OPENCLAW_TOOL; drops `mcp__*` and `AskUserQuestion` (recorded in SUMMARY);
 * throws on any unknown token (fail loud — Pitfall 2/3). Asserts exactly 33 sources
 * (Pitfall 4) and tools.allow.length > 0 for every record.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentDefinition, CC_TO_OPENCLAW_TOOL } from "../src/agents/types.ts";
import { adaptGsdText } from "./adapt-gsd.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const SRC_AGENTS = join(REPO_ROOT, "src", "agents");
const AGENTS_DIR = join(homedir(), ".claude", "agents");

/** Map ONE CC tool token to an OpenClaw tool id, or null if intentionally dropped. */
export function mapTool(ccName: string): string | null {
  if (ccName.startsWith("mcp__")) return null; // A1 — no MCP passthrough id; exec/web fallback
  if (ccName in CC_TO_OPENCLAW_TOOL) return CC_TO_OPENCLAW_TOOL[ccName];
  throw new Error(`Unknown CC tool token "${ccName}" — refusing to silently drop (AGT-03)`);
}

type Frontmatter = { name?: string; description?: string; effort?: string; tools: string[] };

/** Split `tools:` from raw frontmatter handling both CSV and `- list` forms. */
function parseToolsBlock(fmLines: string[]): string[] {
  const idx = fmLines.findIndex((l) => /^tools:/.test(l));
  if (idx === -1) throw new Error("frontmatter has no `tools:` field");
  const line = fmLines[idx];
  const csv = line.slice(line.indexOf(":") + 1).trim();
  if (csv.length > 0) {
    // CSV form: tools: A, B, C
    return csv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  // Block-list form: `tools:` then `  - X` lines until the next non-list key.
  const out: string[] = [];
  for (let i = idx + 1; i < fmLines.length; i++) {
    const m = /^\s*-\s+(.+?)\s*$/.exec(fmLines[i]);
    if (m) {
      out.push(m[1]);
      continue;
    }
    if (/^\S/.test(fmLines[i])) break; // next top-level key
  }
  return out;
}

function readScalar(fmLines: string[], key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.*)$`);
  for (const l of fmLines) {
    const m = re.exec(l);
    if (m && m[1].trim().length) return m[1].trim();
  }
  return undefined;
}

function parseFrontmatter(fmText: string): Frontmatter {
  const fmLines = fmText.split("\n");
  return {
    name: readScalar(fmLines, "name"),
    description: readScalar(fmLines, "description"),
    effort: readScalar(fmLines, "effort"),
    tools: parseToolsBlock(fmLines),
  };
}

/** Parse one agent .md (frontmatter + body) into a typed AgentDefinition. */
export function parseAgentFile(md: string): AgentDefinition {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md);
  if (!m) throw new Error("file has no YAML frontmatter block");
  const fm = parseFrontmatter(m[1]);
  const prompt = adaptGsdText(m[2].replace(/^\n+/, "")); // PORT-01: agnostic adaptation

  if (!fm.name) throw new Error("frontmatter missing `name`");
  if (!fm.effort) throw new Error(`agent ${fm.name}: frontmatter missing \`effort\``);
  if (!["low", "high", "xhigh"].includes(fm.effort)) {
    throw new Error(`agent ${fm.name}: unexpected effort "${fm.effort}"`);
  }
  const allow = Array.from(
    new Set(fm.tools.map(mapTool).filter((t): t is string => t !== null)),
  );
  if (allow.length === 0) {
    throw new Error(`agent ${fm.name}: empty allowlist after mapping (Pitfall 2)`);
  }
  if (!prompt.trim()) throw new Error(`agent ${fm.name}: empty prompt body`);

  return {
    id: fm.name,
    name: fm.name,
    description: fm.description ?? "",
    prompt,
    tools: { allow },
    thinking: fm.effort as AgentDefinition["thinking"],
  };
}

/** Escape a string for safe inlining inside a TS template literal. */
function tsTemplate(s: string): string {
  return "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
}

function emitRecord(def: AgentDefinition): string {
  const deny = def.tools.deny ? `, deny: ${JSON.stringify(def.tools.deny)}` : "";
  return [
    "  {",
    `    id: ${JSON.stringify(def.id)},`,
    `    name: ${JSON.stringify(def.name)},`,
    `    description: ${JSON.stringify(def.description)},`,
    `    thinking: ${JSON.stringify(def.thinking)},`,
    `    tools: { allow: ${JSON.stringify(def.tools.allow)}${deny} },`,
    `    prompt: ${tsTemplate(def.prompt)},`,
    "  },",
  ].join("\n");
}

/** Read all gsd-*.md, assert 33, emit src/agents/roster.generated.ts. */
export function generateRoster(): { count: number; outPath: string } {
  const files = readdirSync(AGENTS_DIR)
    .filter((f) => f.startsWith("gsd-") && f.endsWith(".md"))
    .sort();
  if (files.length !== 33) {
    throw new Error(`expected 33 gsd-*.md sources, found ${files.length} (Pitfall 4)`);
  }
  const defs = files.map((f) => parseAgentFile(readFileSync(join(AGENTS_DIR, f), "utf8")));

  const header =
    "// GENERATED by scripts/port-agents.ts — DO NOT EDIT BY HAND.\n" +
    "// Re-run: node --experimental-strip-types scripts/port-agents.ts\n" +
    `// Source: ~/.claude/agents/gsd-*.md (${defs.length} agents), ported per AGT-01/AGT-03.\n` +
    'import type { AgentDefinition } from "./types.js";\n\n' +
    "export const ROSTER: AgentDefinition[] = [\n";
  const body = defs.map(emitRecord).join("\n");
  const out = header + body + "\n];\n";

  const outPath = join(SRC_AGENTS, "roster.generated.ts");
  writeFileSync(outPath, out, "utf8");
  return { count: defs.length, outPath };
}

// Run when invoked directly (not when imported by tests).
if (process.argv[1] && basename(process.argv[1]) === "port-agents.ts") {
  const { count, outPath } = generateRoster();
  process.stdout.write(`Generated ${count} agent records → ${outPath}\n`);
}
