/**
 * Workstreams — parallel tracks of GSD work within one project (native port of gsd-core workstream.cjs).
 * Each workstream is a namespaced `.planning/workstreams/<slug>/` holding its OWN STATE.md / ROADMAP.md /
 * REQUIREMENTS.md / phases/, so concurrent milestones/features advance independently. Shared files
 * (PROJECT.md, config.json) stay at the `.planning/` root. The ACTIVE workstream (`.planning/workstreams/
 * .active`) is the track route()/state operate on; with no workstreams, the project uses root `.planning`
 * (single-track default — zero behavior change for simple projects).
 *
 * Dynamic adoption (the requested behavior): `suggestWorkstream(intent)` derives a track name from the type
 * of work, so an agent can auto-route a coding intent to the matching workstream by intent + context.
 */
import fs from "node:fs";
import path from "node:path";

/** Escape regex-special chars so a workstream name read raw from disk can't break (or hijack) a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Slugify a workstream name → lowercase, alphanumerics + single dashes, bounded. Rejects empty/traversal. */
export function workstreamSlug(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!slug) throw new Error(`invalid workstream name: ${JSON.stringify(name)}`);
  return slug;
}

function workstreamsRoot(planningDir: string): string {
  return path.join(planningDir, "workstreams");
}

function activeFile(planningDir: string): string {
  return path.join(workstreamsRoot(planningDir), ".active");
}

/** The active workstream slug, or null if no workstreams exist / none active. */
export function activeWorkstream(planningDir: string): string | null {
  try {
    const slug = fs.readFileSync(activeFile(planningDir), "utf8").trim();
    return slug && fs.existsSync(path.join(workstreamsRoot(planningDir), slug)) ? slug : null;
  } catch {
    return null;
  }
}

/** The planning dir route()/state should operate on: the ACTIVE workstream's dir, else `planningDir` itself. */
export function resolveWorkstreamDir(planningDir: string): string {
  const slug = activeWorkstream(planningDir);
  return slug ? path.join(workstreamsRoot(planningDir), slug) : planningDir;
}

export interface WorkstreamInfo {
  name: string;
  active: boolean;
  status: string | null;
  dir: string;
}

/** List all workstreams with their status (read from each track's STATE.md frontmatter). */
export function listWorkstreams(planningDir: string): WorkstreamInfo[] {
  const root = workstreamsRoot(planningDir);
  let names: string[];
  try {
    names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    return [];
  }
  const active = activeWorkstream(planningDir);
  return names.sort().map((name) => {
    const dir = path.join(root, name);
    let status: string | null = null;
    try {
      const m = /^---\n[\s\S]*?\bstatus:[ \t]*"?([\w-]+)/m.exec(fs.readFileSync(path.join(dir, "STATE.md"), "utf8"));
      status = m?.[1] ?? null;
    } catch {
      /* no STATE yet */
    }
    return { name, active: name === active, status, dir };
  });
}

const SEED_STATE = (name: string): string =>
  `---\nstatus: planning\nworkstream: ${name}\n---\n\n# Project State — ${name}\n\n**Current Phase:** 1\n\n## Decisions\n\n## Blockers\n`;
// Flow-5 seam 2: seed a route()-parseable Phase 1 so a fresh track drives discuss→plan (not phase:null).
const SEED_ROADMAP = (name: string): string =>
  `# Roadmap — ${name}\n\n### Phase 1: Unnamed\n\n**Goal:** Define this workstreams first phase.\n**Requirements:** TBD\n**Plans:** 0 plans\n`;

/** Create a workstream `<slug>/` with a seeded STATE.md + ROADMAP.md + phases/. Sets it active if it's the
 *  first. Idempotent: returns created:false if it already exists. */
export function createWorkstream(planningDir: string, name: string): { created: boolean; slug: string; dir: string } {
  const slug = workstreamSlug(name);
  const dir = path.join(workstreamsRoot(planningDir), slug);
  if (fs.existsSync(dir)) return { created: false, slug, dir };
  fs.mkdirSync(path.join(dir, "phases"), { recursive: true });
  fs.writeFileSync(path.join(dir, "STATE.md"), SEED_STATE(slug));
  fs.writeFileSync(path.join(dir, "ROADMAP.md"), SEED_ROADMAP(slug));
  if (!activeWorkstream(planningDir)) switchWorkstream(planningDir, slug); // first one becomes active
  return { created: true, slug, dir };
}

/** Set the active workstream. Throws if it doesn't exist. */
export function switchWorkstream(planningDir: string, name: string): string {
  const slug = workstreamSlug(name);
  if (!fs.existsSync(path.join(workstreamsRoot(planningDir), slug))) throw new Error(`workstream not found: ${slug}`);
  fs.mkdirSync(workstreamsRoot(planningDir), { recursive: true });
  fs.writeFileSync(activeFile(planningDir), slug + "\n");
  return slug;
}

/** Archive a completed workstream into `workstreams/.archive/<slug>/`; clears active if it was active. */
export function completeWorkstream(planningDir: string, name: string): { archived: boolean; slug: string } {
  const slug = workstreamSlug(name);
  const dir = path.join(workstreamsRoot(planningDir), slug);
  if (!fs.existsSync(dir)) return { archived: false, slug };
  const archiveDir = path.join(workstreamsRoot(planningDir), ".archive");
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.renameSync(dir, path.join(archiveDir, slug));
  if (activeWorkstream(planningDir) === slug) {
    try {
      fs.rmSync(activeFile(planningDir));
    } catch {
      /* none */
    }
  }
  return { archived: true, slug };
}

/** Work-type → suggested workstream name, from intent keywords (the dynamic-adoption signal). */
const TYPE_RULES: { re: RegExp; name: string }[] = [
  { re: /\b(auth\w*|oauth|login|logout|sso|saml|jwt|session|credential\w*|password)\b/i, name: "auth" },
  { re: /\b(ui|frontend|front-end|css|component|design|dashboard|page)\b/i, name: "frontend" },
  { re: /\b(api|backend|endpoint|server|route|handler|service)\b/i, name: "backend" },
  { re: /\b(bug|debug\w*|flaky|crash\w*|regression|fix\w*|broken)\b/i, name: "fixes" },
  { re: /\b(doc\w*|readme|changelog)\b/i, name: "docs" },
  { re: /\b(test\w*|coverage|e2e|integration test)\b/i, name: "testing" },
  { re: /\b(ai|llm|embedding|eval\w*|model|rag|agent|spark|dgx|gpu)\b/i, name: "ai" },
  { re: /\b(infra|deploy\w*|ci|cd|pipeline|docker|k8s|terraform)\b/i, name: "infra" },
  { re: /\b(secur\w*|vuln\w*|threat\w*|harden\w*)\b/i, name: "security" },
  { re: /\b(perf\w*|optimi\w*|latency|throughput|scal\w*)\b/i, name: "performance" },
];

/** Suggest the workstream a coding intent belongs to (dynamic adoption). Returns an EXISTING match first
 *  (so related work joins the live track), else the type-derived name, else null (use the default track). */
export function suggestWorkstream(intent: string, planningDir?: string): string | null {
  const text = (intent ?? "").slice(0, 8192);
  let typed: string | null = null;
  for (const r of TYPE_RULES) {
    if (r.re.test(text)) {
      typed = r.name;
      break;
    }
  }
  if (planningDir) {
    const existing = listWorkstreams(planningDir).map((w) => w.name);
    if (typed && existing.includes(typed)) return typed; // join the live track
    // also: if the intent literally names an existing workstream, prefer it. ESCAPE the name — a workstream dir
    // named with regex metachars (c++, a(b) is read raw from readdirSync and `new RegExp("\\bc++\\b")` throws an
    // uncaught SyntaxError, crashing suggestion; unescaped `a.b` would also false-match.
    for (const name of existing) if (new RegExp(`\\b${escapeRe(name)}\\b`, "i").test(text)) return name;
  }
  return typed;
}
