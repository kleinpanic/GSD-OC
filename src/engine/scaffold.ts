/**
 * OCT-2 — project init / scaffold. Greenfield projects had no `.planning/` — `bootstrapGsdConfig` wrote only
 * config.json, so a coding prompt hit a half-initialized GSD (no STATE/ROADMAP). `scaffoldPlanning` writes the
 * full canonical layout via NATIVE helpers (not the agent — the byte layout stays in the plugin's hands, the
 * write-guarantee), then `validateArtifacts` confirms the scaffold is route()-parseable. Idempotent: never
 * overwrites an existing STATE.md (like bootstrapGsdConfig).
 */
import fs from "node:fs";
import path from "node:path";
import { bootstrapGsdConfig } from "./config.js";
import { validateArtifacts, type VerifyResult } from "./verify.js";

export interface ScaffoldResult {
  created: boolean;
  files: string[];
  validation: VerifyResult;
}

const STATE_TPL = (now: string): string =>
  `---\nstatus: planning\nlast_updated: "${now}"\n---\n\n# Project State\n\n**Current Phase:** 1\n**Total Phases:** 1\n**Current Phase Name:** Unnamed\n\n## Decisions\n\n## Blockers\n\n## Progress\n- Total Plans: 0\n- Completed Plans: 0\n`;

const ROADMAP_TPL = (name: string): string =>
  `# Roadmap — ${name}\n\n### Phase 1: Unnamed\n\n**Goal:** Define this phase (run discuss/plan via gsd_orchestrate or gsd_command).\n**Requirements:** TBD\n**Plans:** 0 plans\n`;

const REQUIREMENTS_TPL = (name: string): string =>
  `# Requirements — ${name}\n\n## v1 Requirements\n\n- [ ] PROJ-01: Define the project's core requirements.\n\n## Traceability\n\n| Requirement | Phase |\n|---|---|\n| PROJ-01 | 1 |\n`;

const PROJECT_TPL = (name: string, description: string): string =>
  `# Project: ${name}\n\n**Core Value:** ${description || "TBD"}\n\n## Requirements\n\nSee REQUIREMENTS.md.\n\n## Key Decisions\n\n_None yet._\n`;

/**
 * Scaffold `.planning/` for a new project. Writes config.json (bootstrap), STATE.md, ROADMAP.md,
 * REQUIREMENTS.md, PROJECT.md, and the `phases/` dir — each from a template that passes validateArtifacts.
 * `now` injected for deterministic tests. Returns the validation result so the caller can gate on it.
 */
export function scaffoldPlanning(
  planningDir: string,
  opts: { projectName?: string; description?: string } = {},
  now: string = new Date().toISOString(),
): ScaffoldResult {
  const name = (opts.projectName ?? path.basename(path.dirname(path.resolve(planningDir)))) || "project";
  // Idempotency guard (mirror bootstrapGsdConfig) — never clobber an initialized project.
  if (fs.existsSync(path.join(planningDir, "STATE.md"))) {
    return { created: false, files: [], validation: validateArtifacts(planningDir) };
  }
  fs.mkdirSync(path.join(planningDir, "phases"), { recursive: true });
  bootstrapGsdConfig(planningDir); // config.json (typed JSON — structurally guaranteed)

  const writes: [string, string][] = [
    ["STATE.md", STATE_TPL(now)],
    ["ROADMAP.md", ROADMAP_TPL(name)],
    ["REQUIREMENTS.md", REQUIREMENTS_TPL(name)],
    ["PROJECT.md", PROJECT_TPL(name, opts.description ?? "")],
  ];
  const files = ["config.json", "phases/"];
  for (const [file, body] of writes) {
    fs.writeFileSync(path.join(planningDir, file), body);
    files.push(file);
  }
  return { created: true, files, validation: validateArtifacts(planningDir) };
}
