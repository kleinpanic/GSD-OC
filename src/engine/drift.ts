/**
 * Codebase Drift Detection — native port of upstream GSD `bin/lib/drift.cjs` (#2003) + the
 * `verify codebase-drift` driver from `bin/lib/verify.cjs` (read as spec only, per R0.3).
 *
 * Detects structural drift between the committed tree and `.planning/codebase/STRUCTURE.md`
 * (produced by gsd-codebase-mapper). Four categories, most-specific wins (migration > route >
 * barrel > new_dir). The pure detector NEVER throws — malformed input yields { skipped: true }.
 * The phase drift gate depends on this non-blocking guarantee.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const DRIFT_CATEGORIES = ["new_dir", "barrel", "migration", "route"] as const;
export type DriftCategory = (typeof DRIFT_CATEGORIES)[number];

/** Category priority when a single file matches multiple rules; higher = more specific = wins. */
const CATEGORY_PRIORITY: Record<DriftCategory, number> = { new_dir: 0, barrel: 1, route: 2, migration: 3 };

const BARREL_RE = /^(packages|apps)\/[^/]+\/src\/index\.(ts|tsx|js|mjs|cjs)$/;

const MIGRATION_RES = [
  /^supabase\/migrations\/.+\.sql$/,
  /^prisma\/migrations\/.+/,
  /^drizzle\/meta\/.+/,
  /^drizzle\/migrations\/.+/,
  /^src\/migrations\/.+\.(ts|js|sql)$/,
  /^db\/migrations\/.+\.(sql|ts|js)$/,
  /^migrations\/.+\.(sql|ts|js)$/,
];

const ROUTE_RES = [
  /^(apps|packages)\/[^/]+\/src\/routes\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /^src\/routes\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /^src\/api\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /^(apps|packages)\/[^/]+\/src\/api\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/,
];

/** Allowlist for `--paths` args spliced into a mapper prompt: repo-relative, no traversal, no shell metachars. */
const SAFE_PATH_RE = /^(?!.*\.\.)(?:[A-Za-z0-9_.][A-Za-z0-9_.\-]*)(?:\/[A-Za-z0-9_.][A-Za-z0-9_.\-]*)*$/;

/** Empty-tree SHA — stable diff base when no mapping commit is recorded. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface DriftElement {
  category: DriftCategory;
  path: string;
}

export interface DriftResult {
  skipped: boolean;
  reason?: string;
  elements: DriftElement[];
  actionRequired: boolean;
  directive: "none" | "warn" | "auto-remap";
  spawnMapper: boolean;
  affectedPaths: string[];
  threshold?: number;
  action?: "warn" | "auto-remap";
  message: string;
  counts?: { added: number; modified: number; deleted: number };
}

/** Classify a single repo-relative path into a specific drift category, or null. */
export function classifyFile(file: string): "barrel" | "migration" | "route" | null {
  if (typeof file !== "string" || !file) return null;
  const norm = file.replace(/\\/g, "/");
  if (MIGRATION_RES.some((r) => r.test(norm))) return "migration";
  if (ROUTE_RES.some((r) => r.test(norm))) return "route";
  if (BARREL_RE.test(norm)) return "barrel";
  return null;
}

/**
 * True iff any directory prefix of `file` appears in `structureMd`. STRUCTURE.md is free-form
 * markdown (not a manifest), so the check is deliberately substring-based.
 */
function isPathMapped(file: string, structureMd: string): boolean {
  const norm = file.replace(/\\/g, "/");
  const parts = norm.split("/");
  for (let i = parts.length - 1; i >= 1; i--) {
    if (structureMd.includes(parts.slice(0, i).join("/"))) return true;
  }
  if (parts.length > 0 && structureMd.includes(parts[0] + "/")) return true;
  if (parts.length > 0 && structureMd.includes("`" + parts[0] + "`")) return true;
  return false;
}

function skipped(reason: string): DriftResult {
  return { skipped: true, reason, elements: [], actionRequired: false, directive: "none", spawnMapper: false, affectedPaths: [], message: "" };
}

export interface DetectDriftInput {
  addedFiles?: unknown;
  modifiedFiles?: unknown;
  deletedFiles?: unknown;
  structureMd?: string | null;
  threshold?: number;
  action?: "warn" | "auto-remap";
}

/** Detect codebase drift from parsed git-diff file lists + STRUCTURE.md. Never throws. */
export function detectDrift(input: DetectDriftInput): DriftResult {
  try {
    if (!input || typeof input !== "object") return skipped("invalid-input");
    const { addedFiles, modifiedFiles, deletedFiles, structureMd } = input;
    const threshold = Number.isInteger(input.threshold) && (input.threshold as number) >= 1 ? (input.threshold as number) : 3;
    const action = input.action === "auto-remap" ? "auto-remap" : "warn";

    if (structureMd === null || structureMd === undefined) return skipped("missing-structure-md");
    if (typeof structureMd !== "string") return skipped("invalid-structure-md");

    const added = Array.isArray(addedFiles) ? (addedFiles.filter((x) => typeof x === "string") as string[]) : [];
    const modified = Array.isArray(modifiedFiles) ? (modifiedFiles as string[]) : [];
    const deleted = Array.isArray(deletedFiles) ? (deletedFiles as string[]) : [];

    // One element per file, highest-priority category wins.
    const seen = new Map<string, DriftCategory>();
    for (const rawFile of added) {
      const file = rawFile.replace(/\\/g, "/");
      const specific = classifyFile(file);
      let category: DriftCategory | null = specific;
      if (!category) {
        if (!isPathMapped(file, structureMd)) category = "new_dir";
        else continue; // mapped, ordinary file — not drift
      }
      const prior = seen.get(file);
      if (prior && CATEGORY_PRIORITY[prior] >= CATEGORY_PRIORITY[category]) continue;
      seen.set(file, category);
    }

    const elements: DriftElement[] = [...seen.entries()].map(([p, category]) => ({ category, path: p }));
    elements.sort((a, b) => (a.category === b.category ? a.path.localeCompare(b.path) : a.category.localeCompare(b.category)));

    const actionRequired = elements.length >= threshold;
    let directive: DriftResult["directive"] = "none";
    let spawnMapper = false;
    let affectedPaths: string[] = [];
    let message = "";
    if (actionRequired) {
      directive = action;
      affectedPaths = chooseAffectedPaths(elements.map((e) => e.path));
      if (action === "auto-remap") spawnMapper = true;
      message = buildMessage(elements, affectedPaths, action);
    }

    return {
      skipped: false,
      elements,
      actionRequired,
      directive,
      spawnMapper,
      affectedPaths,
      threshold,
      action,
      message,
      counts: { added: added.length, modified: modified.length, deleted: deleted.length },
    };
  } catch (err) {
    return skipped("exception:" + (err instanceof Error ? err.message : String(err)));
  }
}

function buildMessage(elements: DriftElement[], affectedPaths: string[], action: string): string {
  const byCat: Partial<Record<DriftCategory, string[]>> = {};
  for (const e of elements) (byCat[e.category] ||= []).push(e.path);
  const labels: Record<DriftCategory, string> = {
    new_dir: "New directories",
    barrel: "New barrel exports",
    migration: "New migrations",
    route: "New route modules",
  };
  const lines = [`Codebase drift detected: ${elements.length} structural element(s) since last mapping.`, ""];
  for (const cat of DRIFT_CATEGORIES) {
    if (byCat[cat]) {
      lines.push(`${labels[cat]}:`);
      for (const p of byCat[cat]!) lines.push(`  - ${p}`);
    }
  }
  lines.push("");
  if (action === "auto-remap") lines.push(`Auto-remap scheduled for paths: ${affectedPaths.join(", ")}`);
  else lines.push(`Run /gsd-map-codebase --paths ${affectedPaths.join(",")} to refresh planning context.`);
  return lines.join("\n");
}

/** Collapse drifted paths into sorted top-level prefixes (depth 2 for apps|packages layouts, depth 1 otherwise). */
export function chooseAffectedPaths(paths: string[]): string[] {
  const out = new Set<string>();
  for (const raw of paths || []) {
    if (typeof raw !== "string" || !raw) continue;
    const parts = raw.replace(/\\/g, "/").split("/");
    if (parts.length === 0) continue;
    const top = parts[0];
    if ((top === "apps" || top === "packages") && parts.length >= 2) out.add(`${top}/${parts[1]}`);
    else out.add(top);
  }
  return [...out].sort();
}

/** Drop any path that is absolute, contains traversal, or includes shell metacharacters. */
export function sanitizePaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  return paths.filter((p): p is string => typeof p === "string" && !p.startsWith("/") && SAFE_PATH_RE.test(p));
}

// ─── Frontmatter (last_mapped_commit baseline) ───────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  if (typeof content !== "string") return { data: {}, body: "" };
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: content };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2];
  }
  return { data, body: content.slice(m[0].length) };
}

function serializeFrontmatter(data: Record<string, string>, body: string): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return body;
  return ["---", ...keys.map((k) => `${k}: ${data[k]}`), "---"].join("\n") + "\n" + body;
}

/** Read `last_mapped_commit` from a `.planning/codebase/*.md` frontmatter, or null. */
export function readMappedCommit(filePath: string): string | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const sha = parseFrontmatter(content).data.last_mapped_commit;
  return typeof sha === "string" && sha.length > 0 ? sha : null;
}

/** Upsert `last_mapped_commit` (+ optional `last_mapped_at`) into a file's frontmatter, preserving the body. */
export function writeMappedCommit(filePath: string, commitSha: string, isoDate?: string): void {
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const { data, body } = parseFrontmatter(content);
  data.last_mapped_commit = commitSha;
  if (isoDate) data.last_mapped_at = isoDate;
  fs.writeFileSync(filePath, serializeFrontmatter(data, body));
}

// ─── Driver (verify codebase-drift) ──────────────────────────────────────────

function git(repoRoot: string, args: string[]): { ok: boolean; out: string } {
  try {
    const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
    return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

export interface CodebaseDriftOptions {
  threshold?: number;
  action?: "warn" | "auto-remap";
}

/**
 * The drift GATE: diff the working tree against `last_mapped_commit` (or the empty-tree SHA) and
 * classify the added files against STRUCTURE.md. Non-blocking — any failure yields { skipped: true }
 * so execute-phase's drift gate can never fail the phase. `repoRoot` is the project root (contains .planning).
 */
export function codebaseDrift(repoRoot: string, opts: CodebaseDriftOptions = {}): DriftResult & { lastMappedCommit?: string | null } {
  try {
    const structurePath = path.join(repoRoot, ".planning", "codebase", "STRUCTURE.md");
    if (!fs.existsSync(structurePath)) return { ...skipped("no-structure-md") };
    let structureMd: string;
    try {
      structureMd = fs.readFileSync(structurePath, "utf8");
    } catch (err) {
      return { ...skipped("cannot-read-structure-md: " + (err instanceof Error ? err.message : String(err))) };
    }

    const lastMapped = readMappedCommit(structurePath);
    if (!git(repoRoot, ["rev-parse", "HEAD"]).ok) return { ...skipped("not-a-git-repo") };

    let base = lastMapped || EMPTY_TREE;
    if (lastMapped && !git(repoRoot, ["cat-file", "-t", lastMapped]).ok) base = EMPTY_TREE;

    const diff = git(repoRoot, ["diff", "--name-status", base, "HEAD"]);
    if (!diff.ok) return { ...skipped("git-diff-failed") };

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    for (const line of diff.out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const m = line.match(/^([A-Z])\d*\t(.+?)(?:\t(.+))?$/);
      if (!m) continue;
      const status = m[1];
      const file = m[3] || m[2]; // renames/copies → new path
      if (status === "A" || status === "R" || status === "C") added.push(file);
      else if (status === "M") modified.push(file);
      else if (status === "D") deleted.push(file);
    }

    const result = detectDrift({
      addedFiles: added,
      modifiedFiles: modified,
      deletedFiles: deleted,
      structureMd,
      threshold: opts.threshold,
      action: opts.action,
    });
    return { ...result, lastMappedCommit: lastMapped };
  } catch (err) {
    return { ...skipped("exception: " + (err instanceof Error ? err.message : String(err))) };
  }
}
