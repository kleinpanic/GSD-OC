/**
 * Plan-targeted integrity checks — native port of upstream `verify plan-structure` + `verify references`
 * (verify.cjs). Unlike the `.planning`-relative validators in verify.ts, these take a single FILE path
 * (a PLAN.md / any doc) plus the repo root, and are pure read-only. The structured-must_haves checks
 * (verify artifacts / key-links) need a nested YAML parser and are intentionally not ported here yet.
 */
import fs from "node:fs";
import path from "node:path";

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Presence-oriented frontmatter parse: top-level `key:` lines in the leading --- block, value as raw string. */
function frontmatterKeys(content: string): Record<string, string> {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*):[ \t]*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

export interface PlanStructureResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  task_count: number;
  tasks: { name: string; hasFiles: boolean; hasAction: boolean; hasVerify: boolean; hasDone: boolean }[];
  frontmatter_fields: string[];
  error?: string;
  path?: string;
}

/** Validate a PLAN.md: required frontmatter fields + `<task>` XML structure + wave/autonomous consistency. */
export function verifyPlanStructure(filePath: string, repoRoot = process.cwd()): PlanStructureResult | { error: string; path: string } {
  const full = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  const content = safeRead(full);
  if (content == null) return { error: "File not found", path: filePath };

  const fm = frontmatterKeys(content);
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of ["phase", "plan", "type", "wave", "depends_on", "files_modified", "autonomous", "must_haves"])
    if (fm[field] === undefined) errors.push(`Missing required frontmatter field: ${field}`);

  const tasks: PlanStructureResult["tasks"] = [];
  for (const m of content.matchAll(/<task[^>]*>([\s\S]*?)<\/task>/g)) {
    const tc = m[1];
    const nameMatch = tc.match(/<name>([\s\S]*?)<\/name>/);
    const name = nameMatch ? nameMatch[1].trim() : "unnamed";
    const hasFiles = /<files>/.test(tc);
    const hasAction = /<action>/.test(tc);
    const hasVerify = /<verify>/.test(tc);
    const hasDone = /<done>/.test(tc);
    if (!nameMatch) errors.push("Task missing <name> element");
    if (!hasAction) errors.push(`Task '${name}' missing <action>`);
    if (!hasVerify) warnings.push(`Task '${name}' missing <verify>`);
    if (!hasDone) warnings.push(`Task '${name}' missing <done>`);
    if (!hasFiles) warnings.push(`Task '${name}' missing <files>`);
    tasks.push({ name, hasFiles, hasAction, hasVerify, hasDone });
  }
  if (tasks.length === 0) warnings.push("No <task> elements found");

  // wave > 1 should declare dependencies (depends_on empty / `[]`)
  const waveNum = parseInt(fm.wave ?? "", 10);
  if (waveNum > 1 && (fm.depends_on === undefined || fm.depends_on.trim() === "" || fm.depends_on.trim() === "[]"))
    warnings.push("Wave > 1 but depends_on is empty");

  // checkpoint tasks require autonomous:false
  if (/<task\s+type=["']?checkpoint/.test(content) && fm.autonomous !== "false") errors.push("Has checkpoint tasks but autonomous is not false");

  return { valid: errors.length === 0, errors, warnings, task_count: tasks.length, tasks, frontmatter_fields: Object.keys(fm) };
}

export interface ReferencesResult {
  valid: boolean;
  found: number;
  missing: string[];
  total: number;
  error?: string;
  path?: string;
}

/** Check that @-references and backtick file paths in a doc resolve on disk. */
export function verifyReferences(filePath: string, repoRoot = process.cwd(), home = process.env.HOME ?? ""): ReferencesResult | { error: string; path: string } {
  const full = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  const content = safeRead(full);
  if (content == null) return { error: "File not found", path: filePath };

  const found: string[] = [];
  const missing: string[] = [];

  // @path/to/file — must contain a slash to count as a path.
  for (const ref of content.match(/@([^\s\n,)]+\/[^\s\n,)]+)/g) ?? []) {
    const clean = ref.slice(1);
    const resolved = clean.startsWith("~/") ? path.join(home, clean.slice(2)) : path.join(repoRoot, clean);
    (fs.existsSync(resolved) ? found : missing).push(clean);
  }

  // `path/to/file.ext` backtick paths (skip urls / template vars / already-seen).
  for (const ref of content.match(/`([^`]+\/[^`]+\.[a-zA-Z]{1,10})`/g) ?? []) {
    const clean = ref.slice(1, -1);
    if (clean.startsWith("http") || clean.includes("${") || clean.includes("{{")) continue;
    if (found.includes(clean) || missing.includes(clean)) continue;
    (fs.existsSync(path.join(repoRoot, clean)) ? found : missing).push(clean);
  }

  return { valid: missing.length === 0, found: found.length, missing, total: found.length + missing.length };
}
