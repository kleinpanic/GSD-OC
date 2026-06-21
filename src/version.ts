/**
 * UPG-01: the pinned upstream GSD version this port was last generated from.
 *
 * `PORTED_GSD_VERSION` is bumped by `scripts/sync-upstream.ts` after a successful
 * re-snapshot of the corpus + roster from a newer gsd-core install. Drift between
 * this value and the installed gsd-core `VERSION` is what the CI check (UPG-01)
 * flags. Keep it a plain string constant so it inlines into `dist` with no runtime
 * filesystem read (mirrors the corpus/roster build-time-inline policy).
 *
 * Source of truth for the upstream identity: `@opengsd/gsd-core` (repo open-gsd/gsd-core),
 * VERSION file in the detected install, `npm view @opengsd/gsd-core version` for remote latest.
 */
export const UPSTREAM_PACKAGE = "@opengsd/gsd-core";
export const UPSTREAM_REPO = "open-gsd/gsd-core";

/** The gsd-core VERSION string this port's corpus + roster were last generated from. */
export const PORTED_GSD_VERSION = "1.4.5";

/**
 * Semver comparison for the upstream-drift gate. Compares the NUMERIC CORE (strips a leading `v` and any
 * pre-release/build suffix), then breaks ties by pre-release ordering (a release outranks its pre-release).
 * THROWS on a non-semver string rather than falling back to lexicographic compare — a string fallback reported a
 * newer upstream as "ahead"/"in-sync" and silently let the corpus go stale (the BLOCKER this replaces).
 * Returns -1 (a<b), 0 (equal), 1 (a>b).
 */
export function cmpSemver(a: string, b: string): number {
  const parse = (s: string) => {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.*))?$/.exec(s.trim());
    return m ? { core: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ?? "" } : null;
  };
  const va = parse(a), vb = parse(b);
  if (!va || !vb) throw new Error(`cmpSemver: non-semver version (${JSON.stringify(!va ? a : b)}) — refusing the string fallback that masked drift`);
  for (let i = 0; i < 3; i++) {
    const d = va.core[i] - vb.core[i];
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (va.pre === vb.pre) return 0;
  if (!va.pre) return 1;
  if (!vb.pre) return -1;
  return va.pre < vb.pre ? -1 : 1;
}
