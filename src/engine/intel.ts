/**
 * Intel — native port of the READ side of upstream `bin/lib/intel.cjs` (the project intel index: file roles,
 * api map, dependency graph, arch decisions, stack). Config-gated + OPTIONAL (intel.enabled, off by default).
 * Pure: gates on config, reads the `.planning/intel/*.json` files, and answers query/status. The BUILD/update
 * side (agents writing intel data) is not reproduced — `intelExtractExports` is the one deterministic primitive
 * that helps an agent build intel from source (it does NOT gate, matching upstream).
 */
import fs from "node:fs";
import path from "node:path";
import { type Clock, realClock } from "./state.js";

export const INTEL_FILES = {
  files: "file-roles.json",
  apis: "api-map.json",
  deps: "dependency-graph.json",
  arch: "arch-decisions.json",
  stack: "stack.json",
} as const;

/** Config gate: intel is enabled only when `.planning/config.json` has `intel.enabled === true`. Off by default. */
export function isIntelEnabled(planningDir: string): boolean {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(planningDir, "config.json"), "utf8"));
    return !!(cfg && cfg.intel && cfg.intel.enabled === true);
  } catch {
    return false;
  }
}

export function disabledResponse(): { disabled: true; message: string } {
  return { disabled: true, message: "Intel system disabled. Set intel.enabled=true in config.json to activate." };
}

function intelFilePath(planningDir: string, filename: string): string {
  return path.join(planningDir, "intel", filename);
}

function safeReadJson<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Recursively check whether `lowerTerm` appears in any string value. */
function matchesInValue(value: unknown, lowerTerm: string): boolean {
  if (typeof value === "string") return value.toLowerCase().includes(lowerTerm);
  if (Array.isArray(value)) return value.some((v) => matchesInValue(v, lowerTerm));
  if (value && typeof value === "object") return Object.values(value).some((v) => matchesInValue(v, lowerTerm));
  return false;
}

/** Search a JSON intel object's keys + string values (recursive) for `term`. Skips the `_meta` key. */
function searchJsonEntries(data: unknown, term: string): { key: string; value: unknown }[] {
  if (!data || typeof data !== "object") return [];
  const entries = (data as { entries?: unknown }).entries ?? data;
  if (!entries || typeof entries !== "object") return [];
  const lower = term.toLowerCase();
  const matches: { key: string; value: unknown }[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (key === "_meta") continue;
    if (key.toLowerCase().includes(lower) || matchesInValue(value, lower)) matches.push({ key, value });
  }
  return matches;
}

export interface IntelQueryResult {
  matches: { source: string; entries: { key: string; value: unknown }[] }[];
  term: string;
  total: number;
}

/** Query all JSON intel files (keys + values) for a case-insensitive term. */
export function intelQuery(planningDir: string, term: string): IntelQueryResult | { disabled: true; message: string } {
  if (!isIntelEnabled(planningDir)) return disabledResponse();
  const matches: IntelQueryResult["matches"] = [];
  let total = 0;
  for (const filename of Object.values(INTEL_FILES)) {
    const data = safeReadJson(intelFilePath(planningDir, filename));
    if (!data) continue;
    const found = searchJsonEntries(data, term);
    if (found.length > 0) {
      matches.push({ source: filename, entries: found });
      total += found.length;
    }
  }
  return { matches, term, total };
}

export interface IntelStatusResult {
  files: Record<string, { exists: boolean; updated_at: string | null; stale: boolean }>;
  overall_stale: boolean;
}

/** Report existence + staleness (>24h since `_meta.updated_at`) of each intel file. */
export function intelStatus(planningDir: string, clock: Pick<Clock, "now"> = realClock): IntelStatusResult | { disabled: true; message: string } {
  if (!isIntelEnabled(planningDir)) return disabledResponse();
  const STALE_MS = 24 * 60 * 60 * 1000;
  const now = clock.now();
  const files: IntelStatusResult["files"] = {};
  let overallStale = false;
  for (const filename of Object.values(INTEL_FILES)) {
    const filePath = intelFilePath(planningDir, filename);
    if (!fs.existsSync(filePath)) {
      files[filename] = { exists: false, updated_at: null, stale: true };
      overallStale = true;
      continue;
    }
    const data = safeReadJson<{ _meta?: { updated_at?: string } }>(filePath);
    const updatedAt = data?._meta?.updated_at ?? null;
    let stale = true;
    if (updatedAt) stale = now - new Date(updatedAt).getTime() > STALE_MS;
    if (stale) overallStale = true;
    files[filename] = { exists: true, updated_at: updatedAt, stale };
  }
  return { files, overall_stale: overallStale };
}

export interface ExtractExportsResult {
  file: string;
  exports: string[];
  method: "none" | "module.exports" | "exports.X" | "esm" | "mixed";
}

/**
 * Extract exported symbol names from a JS/TS/CJS/MJS file (CJS `module.exports = {…}` brace-matched, `exports.X`,
 * and ESM `export` forms). Deterministic, does NOT gate on intel.enabled — a primitive for agents building intel.
 */
export function intelExtractExports(filePath: string): ExtractExportsResult {
  if (!fs.existsSync(filePath)) return { file: filePath, exports: [], method: "none" };
  const content = fs.readFileSync(filePath, "utf8");
  const exports: string[] = [];
  let method: ExtractExportsResult["method"] = "none";

  // CJS: the LAST `module.exports = {` (the real one), brace-matched.
  const cjsMatches = [...content.matchAll(/module\.exports\s*=\s*\{/g)];
  if (cjsMatches.length > 0) {
    const last = cjsMatches[cjsMatches.length - 1];
    const startIdx = last.index! + last[0].length;
    let depth = 1,
      endIdx = startIdx;
    while (endIdx < content.length && depth > 0) {
      if (content[endIdx] === "{") depth++;
      else if (content[endIdx] === "}") depth--;
      if (depth > 0) endIdx++;
    }
    method = "module.exports";
    for (const line of content.substring(startIdx, endIdx).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      const keyMatch = trimmed.match(/^(\w+)\s*[,}:]/) || trimmed.match(/^(\w+)$/);
      if (keyMatch) exports.push(keyMatch[1]);
    }
  }

  // CJS: individual `exports.X =` at line start.
  for (const m of content.matchAll(/^exports\.(\w+)\s*=/gm)) {
    if (!exports.includes(m[1])) {
      exports.push(m[1]);
      if (method === "none") method = "exports.X";
    }
  }
  const hadCjs = exports.length > 0;

  // ESM forms.
  const esm: string[] = [];
  for (const m of content.matchAll(/^export\s+default\s+(?:function|class)\s+(\w+)/gm)) if (!esm.includes(m[1])) esm.push(m[1]);
  if (/^export\s+default\s+(?!function\s|class\s)/m.test(content) && esm.length === 0) esm.push("default");
  for (const m of content.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)\s*\(/gm)) if (!esm.includes(m[1])) esm.push(m[1]);
  for (const m of content.matchAll(/^export\s+(?:const|let|var)\s+(\w+)\s*=/gm)) if (!esm.includes(m[1])) esm.push(m[1]);
  for (const m of content.matchAll(/^export\s+class\s+(\w+)/gm)) if (!esm.includes(m[1])) esm.push(m[1]);
  for (const m of content.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const item of m[1].split(",")) {
      const name = item.trim().split(/\s+as\s+/)[0].trim();
      if (name && !esm.includes(name)) esm.push(name);
    }
  }
  for (const e of esm) if (!exports.includes(e)) exports.push(e);

  const hadEsm = esm.length > 0;
  if (hadCjs && hadEsm) method = "mixed";
  else if (hadEsm && !hadCjs) method = "esm";

  return { file: filePath, exports, method };
}
