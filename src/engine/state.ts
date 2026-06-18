import fs from "node:fs";

/**
 * STATE.md atomic-write core (STATE-02 / D-03).
 *
 * Reproduces the lockfile mutual-exclusion semantics of upstream
 * `~/.claude/gsd-core/bin/lib/state.cjs` (lines 1009-1176) in native TypeScript.
 * That `.cjs` is a READ-ONLY behavioral spec (R0.3): this module never shells out
 * to it, never requires it, and adds no opengsd / @anthropic-ai dependency.
 *
 * The Phase-1 reader is folded in via re-export (D-02), not reimplemented.
 */
export { readState, type ReadStateResult } from "../state/read-state.js";

/**
 * Clock seam (mirrors state.cjs's `clock` parameter). Tests inject a fake clock
 * to drive timeout/stale logic deterministically without real wall-clock waits.
 */
export type Clock = {
  now(): number;
  sleep(ms: number): void;
};

/** Real clock: Date.now + a synchronous Atomics.wait sleep (no busy spin). */
export const realClock: Clock = {
  now: () => Date.now(),
  sleep(ms: number): void {
    if (ms <= 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
};

// Timing constants — match state.cjs:1039-1041.
const RETRY_DELAY_MS = 200;
const STALE_THRESHOLD_MS = 10000;
const MAX_WAIT_MS = 30000;

/**
 * Transient errno codes indicating a temporary filesystem condition under
 * concurrent O_EXCL races (Docker overlay-fs, NFS, OS signals, AV scanners).
 * Recoverable → retry. Truly fatal codes (EMFILE, ENOSPC, EROFS, EACCES) are
 * NOT in this set and propagate immediately. Mirrors state.cjs:1015-1024.
 */
const ACQUIRE_LOCK_RETRY_ERRNOS = new Set([
  "EPERM",
  "EBUSY",
  "EAGAIN",
  "EINTR",
  "EINVAL",
  "EIO",
  "ESTALE",
]);

// M-02: ENOENT from an O_CREAT|O_EXCL open is NOT transient — it means the
// PARENT directory of the lock path does not exist (a genuine config error).
// Treating it as retryable spins the full MAX_WAIT_MS budget then throws a
// misleading "held by live process" error. Fail fast with a clear diagnostic.

/**
 * Acquire `${statePath}.lock` via O_CREAT|O_EXCL|O_WRONLY, writing the pid.
 * On EEXIST: reclaim the lock if its mtime is older than the stale threshold
 * (crashed holder), else spin-wait with jitter until maxWaitMs then throw.
 * Reproduces state.cjs:1035-1085.
 */
export function acquireStateLock(statePath: string, clock: Clock = realClock): string {
  const lockPath = statePath + ".lock";
  const startedAt = clock.now();

  for (;;) {
    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      );
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // M-02: ENOENT on the O_EXCL create = missing parent directory (non-transient).
      // Fail fast rather than spin-waiting the full budget on a misclassified error.
      if (code === "ENOENT") {
        throw new Error(
          `acquireStateLock: parent directory of ${lockPath} does not exist ` +
            `(state directory missing) — original errno ENOENT`,
        );
      }
      // Transient filesystem errors are recoverable — retry the loop.
      if (code && ACQUIRE_LOCK_RETRY_ERRNOS.has(code)) continue;
      // Anything that is not EEXIST is fatal — propagate (silent bypass = lost updates).
      if (code !== "EEXIST") throw err;

      // EEXIST: only reclaim a lock we did not place once it has crossed the
      // staleness threshold (crashed holder). Nuking a fresh lock held by a
      // slow-but-live writer causes lost updates.
      try {
        const stat = fs.statSync(lockPath);
        if (clock.now() - stat.mtimeMs > STALE_THRESHOLD_MS) {
          // M-01: rename-based steal (TOCTOU-safe). A blind unlink races a live
          // writer who re-creates the lock between our stat and unlink — we would
          // then delete the live lock and let two writers in. Instead, atomically
          // rename the stale lock to a unique sidecar; only the process whose
          // rename succeeds owns the reclaim. A concurrent fresh O_EXCL lock keeps
          // its own (different) inode and is never clobbered.
          const stolen = `${lockPath}.stale.${process.pid}.${Date.now()}`;
          try {
            fs.renameSync(lockPath, stolen);
          } catch {
            // Lost the race (another reclaimer renamed it, or the holder released
            // and a fresh lock now sits here) — fall through and retry O_EXCL.
            continue;
          }
          // Re-confirm the renamed lock is the SAME stale lock we stat'd (mtime
          // unchanged), then drop it. If a live writer had somehow advanced it,
          // skip the unlink and let the loop re-contend cleanly.
          try {
            const after = fs.statSync(stolen);
            if (after.mtimeMs === stat.mtimeMs) {
              fs.unlinkSync(stolen);
            } else {
              // Different lock than the one we deemed stale — restore best-effort
              // so we don't strand a still-relevant lock body.
              try {
                fs.renameSync(stolen, lockPath);
              } catch {
                /* a fresh O_EXCL lock already occupies lockPath — drop the sidecar */
                try {
                  fs.unlinkSync(stolen);
                } catch {
                  /* already gone */
                }
              }
            }
          } catch {
            /* sidecar already gone */
          }
          continue;
        }
      } catch {
        continue; // released between EEXIST and stat
      }

      if (clock.now() - startedAt >= MAX_WAIT_MS) {
        throw new Error(
          `acquireStateLock: ${lockPath} held by live process for ` +
            `${clock.now() - startedAt}ms (exceeded ${MAX_WAIT_MS}ms budget)`,
        );
      }
      const jitter = Math.floor(Math.random() * 50);
      clock.sleep(RETRY_DELAY_MS + jitter);
    }
  }
}

/** Release the lock by unlinking it; tolerant of an already-gone lock. state.cjs:1086-1092. */
export function releaseStateLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* lock already gone */
  }
}

/** Acquire, run fn, release in finally. state.cjs:1093-1101. */
export function withStateLock<T>(statePath: string, fn: () => T, clock: Clock = realClock): T {
  const lockPath = acquireStateLock(statePath, clock);
  try {
    return fn();
  } finally {
    releaseStateLock(lockPath);
  }
}

/**
 * Write `content` to statePath under the lock. state.cjs:1114-1128 lock-wrapped write.
 *
 * Note: the upstream `syncStateFrontmatter` frontmatter-resync coupling is out of
 * scope this plan (D-02 / plan 02-01 objective) — the caller owns the full content.
 */
export function writeStateMd(statePath: string, content: string, clock: Clock = realClock): void {
  const lockPath = acquireStateLock(statePath, clock);
  try {
    fs.writeFileSync(statePath, content);
  } finally {
    releaseStateLock(lockPath);
  }
}

/**
 * Atomic read-modify-write for STATE.md. Holds the lock across the entire
 * read -> transform -> write cycle, preventing the lost-update problem.
 * Reproduces state.cjs:1149-1176 MINUS the frontmatter-resync coupling
 * (the transform owns the full content).
 */
export function readModifyWriteStateMd(
  statePath: string,
  transformFn: (content: string) => string,
  clock: Clock = realClock,
): void {
  const lockPath = acquireStateLock(statePath, clock);
  try {
    let content = "";
    try {
      content = fs.readFileSync(statePath, "utf8");
    } catch {
      content = "";
    }
    const modified = transformFn(content);
    fs.writeFileSync(statePath, modified);
  } finally {
    releaseStateLock(lockPath);
  }
}
