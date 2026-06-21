/**
 * UPG-01: keep the GSD-OC port in sync with upstream gsd-core releases.
 *
 * Upstream = `@opengsd/gsd-core` (repo open-gsd/gsd-core). The installed copy lives at
 * the *detected* CLI home (e.g. ~/.claude/gsd-core) and carries an authoritative `VERSION`
 * file (no tags / changelog inside the install — only `bin/check-latest-version.cjs` for the
 * remote npm latest). This port snapshots that install at build time (build-corpus + port-agents,
 * both adapt via adapt-gsd) and pins the source version in `src/version.ts` (PORTED_GSD_VERSION).
 *
 * Run modes:
 *   --check   (default) detect installed version, compare to PORTED_GSD_VERSION, exit 0/1/2.
 *             CI-friendly: exit 2 == installed is NEWER than what we ported (drift), exit 0 == in sync.
 *   --sync    re-run build-corpus + port-agents from the installed gsd-core, diff old vs new
 *             corpus manifest + roster, flag porting work (new gsd-tools verbs our engine
 *             doesn't implement, new config keys missing from defaultGsdConfig), then bump
 *             src/version.ts to the installed VERSION.
 *   --json    machine-readable output for either mode.
 *
 * Re-uses the existing build scripts by import — does NOT re-implement the snapshot logic.
 *
 *   node --experimental-strip-types scripts/sync-upstream.ts --check
 *   node --experimental-strip-types scripts/sync-upstream.ts --sync
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { detectGsdInstall } from "../src/retrieval/detect.ts";
import { generateCorpus } from "./build-corpus.ts";       // re-snapshots the corpus from the install
import { generateRoster } from "./port-agents.ts";          // re-ports the 33 personas
import { defaultGsdConfig } from "../src/engine/config.ts";  // for config-key drift
import { PORTED_GSD_VERSION, cmpSemver } from "../src/version.ts";
import type { GsdCorpus, CorpusManifest } from "../src/retrieval/types.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const CORPUS_OUT = join(REPO_ROOT, "src", "retrieval", "corpus.generated.json");
const VERSION_TS = join(REPO_ROOT, "src", "version.ts");

// ── 1. version detection ──────────────────────────────────────────────────────

/** Read the authoritative VERSION file from the detected gsd-core install. */
function installedGsdVersion(): { version: string; root: string; cli: string } | null {
  const install = detectGsdInstall();
  if (!install) return null;
  const vfile = join(install.root, "gsd-core", "VERSION");
  if (!existsSync(vfile)) return null;
  return { version: readFileSync(vfile, "utf8").trim(), root: install.root, cli: install.cli };
}

/** Numeric semver compare. Returns -1 / 0 / 1 (a<b / a==b / a>b); non-semver falls back to string compare. */

// ── 2. drift diffing ──────────────────────────────────────────────────────────

interface ManifestById {
  [id: string]: string; // id -> sha256
}
function manifestIndex(m: CorpusManifest): ManifestById {
  const out: ManifestById = {};
  for (const leaf of m.docs) out[leaf.id] = leaf.sha256;
  return out;
}

interface CorpusDiff {
  added: string[];
  removed: string[];
  changed: string[];
  byKind: Record<string, { added: number; removed: number; changed: number }>;
}

function diffCorpus(oldM: CorpusManifest, newM: CorpusManifest): CorpusDiff {
  const o = manifestIndex(oldM);
  const n = manifestIndex(newM);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const id of Object.keys(n)) {
    if (!(id in o)) added.push(id);
    else if (o[id] !== n[id]) changed.push(id);
  }
  for (const id of Object.keys(o)) if (!(id in n)) removed.push(id);
  const byKind: CorpusDiff["byKind"] = {};
  const bump = (id: string, k: keyof CorpusDiff["byKind"][string]) => {
    const kind = id.split(":")[0];
    (byKind[kind] ??= { added: 0, removed: 0, changed: 0 })[k]++;
  };
  added.forEach((id) => bump(id, "added"));
  removed.forEach((id) => bump(id, "removed"));
  changed.forEach((id) => bump(id, "changed"));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort(), byKind };
}

// ── 3. porting-gap flags ──────────────────────────────────────────────────────

/**
 * gsd-tools verbs the native engine implements (kept in sync with src/engine/route.ts +
 * the orchestrator path verbs). A NEW upstream verb not in this set is porting work: our
 * engine has no native equivalent. This is a deliberately HAND-MAINTAINED allowlist — the
 * point of the flag is to force a human to look at every new verb.
 */
const ENGINE_KNOWN_VERBS = new Set<string>([
  // state / lifecycle
  "state", "state-snapshot", "find-phase", "phases", "phase", "milestone", "progress",
  "roadmap", "requirements", "validate", "verify", "verification", "verify-summary",
  // config
  "config-get", "config-set", "config-path", "config-new-project", "config-ensure-section",
  "config-set-model-profile", "migrate-config",
  // commit / git
  "commit", "check-commit", "commit-to-subrepo",
  // model / resolution
  "resolve-model", "resolve-granularity", "resolve-execution", "effort",
  // misc read-only helpers the engine reimplements or treats as retrieval
  "template", "frontmatter", "generate-slug", "current-timestamp", "stats", "summary-extract",
]);

/** Extract the top-level gsd-tools verbs from the installed bin/gsd-tools.cjs (`case '<verb>':`). */
function installedGsdToolsVerbs(installRoot: string): Set<string> {
  const p = join(installRoot, "gsd-core", "bin", "gsd-tools.cjs");
  if (!existsSync(p)) return new Set();
  const src = readFileSync(p, "utf8");
  const verbs = new Set<string>();
  for (const m of src.matchAll(/case ['"]([a-z][a-z0-9.:_-]+)['"]/g)) verbs.add(m[1]);
  return verbs;
}

/** Flatten the default config to dotted keys so a new upstream key is detectable. */
function configKeys(obj: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      out.add(key);
      for (const sub of configKeys(v, key)) out.add(sub);
    }
  }
  return out;
}

/**
 * Pull upstream's config default keys from the install. CONFIG_DEFAULTS lives in
 * bin/lib (core), referenced by verify.cjs. We scan the lib for `<key>:` assignments under a
 * CONFIG_DEFAULTS object — best-effort: this only FLAGS for human review, never auto-edits config.ts.
 */
function installedConfigKeys(installRoot: string): Set<string> {
  const libDir = join(installRoot, "gsd-core", "bin", "lib");
  const out = new Set<string>();
  const candidates = ["config-defaults.cjs", "config.cjs", "core.cjs"];
  for (const f of candidates) {
    const p = join(libDir, f);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    const block = /CONFIG_DEFAULTS\s*=\s*(?:Object\.freeze\()?\{([\s\S]*?)\n\}/.exec(src);
    if (!block) continue;
    for (const m of block[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gim)) out.add(m[1]);
  }
  return out;
}

// ── 4. orchestration ──────────────────────────────────────────────────────────

interface SyncReport {
  installed: string | null;
  ported: string;
  relation: "in-sync" | "behind" | "ahead" | "no-install";
  corpus?: CorpusDiff;
  newVerbs?: string[];      // upstream verbs the engine doesn't implement
  newConfigKeys?: string[]; // upstream config keys missing from defaultGsdConfig
}

function buildReport(doSync: boolean): SyncReport {
  const inst = installedGsdVersion();
  if (!inst) return { installed: null, ported: PORTED_GSD_VERSION, relation: "no-install" };

  const c = cmpSemver(PORTED_GSD_VERSION, inst.version);
  const relation: SyncReport["relation"] = c === 0 ? "in-sync" : c < 0 ? "behind" : "ahead";
  const report: SyncReport = { installed: inst.version, ported: PORTED_GSD_VERSION, relation };

  if (!doSync) return report;

  // re-snapshot from the (newer) install, diff against the committed corpus manifest
  const oldCorpus: GsdCorpus | null = existsSync(CORPUS_OUT)
    ? (JSON.parse(readFileSync(CORPUS_OUT, "utf8")) as GsdCorpus)
    : null;
  const newCorpus = generateCorpus();
  generateRoster(); // re-emit roster.generated.ts (asserts 33 internally — fails loud on roster drift)

  if (oldCorpus) report.corpus = diffCorpus(oldCorpus.manifest, newCorpus.manifest);
  writeFileSync(CORPUS_OUT, JSON.stringify(newCorpus), "utf8");

  // porting-gap flags
  const verbs = installedGsdToolsVerbs(inst.root);
  report.newVerbs = [...verbs].filter((v) => !ENGINE_KNOWN_VERBS.has(v)).sort();

  const ours = configKeys(defaultGsdConfig());
  const theirs = installedConfigKeys(inst.root);
  report.newConfigKeys = [...theirs].filter((k) => !ours.has(k) && !ours.has(`workflow.${k}`)).sort();

  // pin the version we just ported from
  bumpVersionTs(inst.version);
  return report;
}

function bumpVersionTs(version: string): void {
  const src = readFileSync(VERSION_TS, "utf8");
  const next = src.replace(
    /export const PORTED_GSD_VERSION = "[^"]*";/,
    `export const PORTED_GSD_VERSION = "${version}";`,
  );
  if (next === src) throw new Error("could not locate PORTED_GSD_VERSION assignment in src/version.ts");
  writeFileSync(VERSION_TS, next, "utf8");
}

function render(r: SyncReport): string {
  const lines: string[] = [];
  lines.push(`upstream:  ${r.installed ?? "(no gsd-core install detected)"}`);
  lines.push(`ported:    ${r.ported}`);
  lines.push(`relation:  ${r.relation}`);
  if (r.corpus) {
    const c = r.corpus;
    lines.push(`corpus:    +${c.added.length} / -${c.removed.length} / ~${c.changed.length}`);
    for (const [kind, n] of Object.entries(c.byKind)) {
      lines.push(`  ${kind}: +${n.added} -${n.removed} ~${n.changed}`);
    }
    if (c.added.length) lines.push(`  ADDED: ${c.added.join(", ")}`);
    if (c.removed.length) lines.push(`  REMOVED: ${c.removed.join(", ")}`);
  }
  if (r.newVerbs?.length) {
    lines.push(`PORTING WORK — new gsd-tools verbs the engine lacks:`);
    for (const v of r.newVerbs) lines.push(`  ! ${v}`);
  }
  if (r.newConfigKeys?.length) {
    lines.push(`PORTING WORK — config keys missing from defaultGsdConfig:`);
    for (const k of r.newConfigKeys) lines.push(`  ! ${k}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && basename(process.argv[1]) === "sync-upstream.ts") {
  const args = new Set(process.argv.slice(2));
  const doSync = args.has("--sync");
  const asJson = args.has("--json");
  const report = buildReport(doSync);

  if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(render(report) + "\n");

  // exit codes (CI-friendly):
  //   0 = in sync (or --sync completed)   1 = no install / error   2 = installed is NEWER (drift)
  if (report.relation === "no-install") process.exit(1);
  if (!doSync && report.relation === "behind") process.exit(2);
  process.exit(0);
}
