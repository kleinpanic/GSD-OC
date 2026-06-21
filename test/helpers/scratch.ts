/**
 * Canonical test-fixture helper — the ONE place tests create scratch dirs.
 *
 * Why this exists: tests were rolling their own `mkdtempSync(join(homedir(), "codeWS", ...))`, which leaked fixture
 * dirs into the user's REAL workspace (~/codeWS) when a run was interrupted. This helper enforces a single
 * canonical location + naming + tracked cleanup so that:
 *   - every fixture lives under os.tmpdir()/gsd-oc-tests/  (auto-reaped by the OS; never the user's workspace),
 *   - names are predictable (`<label>-<rand>`), not scattered ad-hoc prefixes,
 *   - cleanup is guaranteed via `cleanupAllScratch()` (registered in a global afterEach/after by callers).
 *
 * The `no-workspace-pollution` guard test asserts NO test source creates dirs outside this helper.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The single canonical root for all test scratch dirs. Under os.tmpdir() → OS-reaped, never ~/codeWS. */
export const SCRATCH_ROOT = join(tmpdir(), "gsd-oc-tests");

const live = new Set<string>();

/** Create a tracked scratch dir `<SCRATCH_ROOT>/<label>-<rand>`. Always under the OS temp dir. */
export function scratchDir(label = "fx"): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const safe = label.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 24) || "fx";
  const dir = mkdtempSync(join(SCRATCH_ROOT, `${safe}-`));
  live.add(dir);
  return dir;
}

/** Create a scratch dir scaffolded as a minimal GSD project (.git marker + a .planning with the given files). */
export function scratchProject(
  label = "proj",
  planning: Record<string, string> = {},
  opts: { git?: boolean } = {},
): { dir: string; planning: string } {
  const dir = scratchDir(label);
  if (opts.git !== false) mkdirSync(join(dir, ".git"), { recursive: true });
  const planningDir = join(dir, ".planning");
  mkdirSync(join(planningDir, "phases"), { recursive: true });
  for (const [name, content] of Object.entries(planning)) {
    const target = join(planningDir, name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return { dir, planning: planningDir };
}

/** Remove one tracked scratch dir (call in a test's finally, or rely on cleanupAllScratch). */
export function removeScratch(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  live.delete(dir);
}

/** Remove every tracked scratch dir + the canonical root. Safe to call repeatedly. */
export function cleanupAllScratch(): void {
  for (const dir of live) rmSync(dir, { recursive: true, force: true });
  live.clear();
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
}
