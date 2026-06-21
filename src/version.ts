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
