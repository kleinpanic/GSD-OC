import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  acquireStateLock,
  releaseStateLock,
  withStateLock,
  writeStateMd,
  readModifyWriteStateMd,
  readState,
  type Clock,
} from "../src/engine/state.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureSrc = join(here, "..", "..", "test", "fixtures", "engine-state", "STATE.md");

/** Copy the committed fixture into a throwaway tmp dir so tests never mutate it. */
function tmpStatePath(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "engine-state-"));
  const p = join(dir, "STATE.md");
  fs.copyFileSync(fixtureSrc, p);
  return p;
}

/** Fake clock: time only advances when the code sleeps — deterministic, no wall-clock waits. */
function fakeClock(start = 0): Clock {
  let t = start;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
    },
  };
}

test("acquireStateLock creates the lock via O_EXCL; release removes it", () => {
  const p = tmpStatePath();
  const lock = acquireStateLock(p);
  assert.equal(lock, p + ".lock");
  assert.ok(fs.existsSync(lock), "lockfile should exist after acquire");
  assert.equal(fs.readFileSync(lock, "utf8"), String(process.pid));
  releaseStateLock(lock);
  assert.ok(!fs.existsSync(lock), "lockfile should be gone after release");
});

test("acquireStateLock spin-waits on a live lock then exceeds the budget and throws", () => {
  const p = tmpStatePath();
  // Pre-place a fresh lock (mtime = now) that is never released.
  fs.writeFileSync(p + ".lock", "99999");
  // Fake clock keeps mtime within the stale threshold (10s) but advances past
  // the 30s budget via sleep accumulation — so we hit the live-lock throw path.
  const clock = fakeClock(0);
  assert.throws(
    () => acquireStateLock(p, clock),
    /held by live process/,
    "a never-released live lock must exceed maxWaitMs and throw",
  );
});

test("acquireStateLock reclaims a stale lock past the threshold", () => {
  const p = tmpStatePath();
  fs.writeFileSync(p + ".lock", "12345");
  // Backdate the lock's mtime well past the 10s stale threshold.
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(p + ".lock", old, old);

  const lock = acquireStateLock(p); // real clock: now - mtime > 10s → reclaim
  assert.equal(lock, p + ".lock");
  assert.equal(fs.readFileSync(lock, "utf8"), String(process.pid), "reclaimed lock holds our pid");
  releaseStateLock(lock);
});

test("withStateLock acquires, runs fn, releases in finally even on throw", () => {
  const p = tmpStatePath();
  const out = withStateLock(p, () => 42);
  assert.equal(out, 42);
  assert.ok(!fs.existsSync(p + ".lock"), "lock released after fn");

  assert.throws(() =>
    withStateLock(p, () => {
      throw new Error("boom");
    }),
  );
  assert.ok(!fs.existsSync(p + ".lock"), "lock released even when fn throws");
});

test("readModifyWriteStateMd replaces a field under lock, leaving no lock behind", () => {
  const p = tmpStatePath();
  readModifyWriteStateMd(p, (c) => c.replace(/^Status:.*$/m, "Status: Executing"));
  const after = fs.readFileSync(p, "utf8");
  assert.match(after, /^Status: Executing$/m, "Status line replaced");
  assert.match(after, /Native State Engine/, "rest of file intact");
  assert.ok(!fs.existsSync(p + ".lock"), "no lockfile left behind");
});

test("writeStateMd writes whole content under the lock", () => {
  const p = tmpStatePath();
  writeStateMd(p, "fresh content\n");
  assert.equal(fs.readFileSync(p, "utf8"), "fresh content\n");
  assert.ok(!fs.existsSync(p + ".lock"));
});

test("M-01: stale-lock steal preserves a fresh lock created in the unlink window (TOCTOU)", () => {
  const p = tmpStatePath();
  const lockPath = p + ".lock";
  // Place a stale lock (mtime well past the 10s threshold).
  fs.writeFileSync(lockPath, "12345");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, old, old);

  // Acquire reclaims the stale lock and writes OUR pid. Crucially the lock that
  // ends up at lockPath must be the one we acquired — not a clobbered fresh lock.
  const lock = acquireStateLock(p);
  assert.equal(lock, lockPath);
  assert.equal(fs.readFileSync(lock, "utf8"), String(process.pid));
  // No stale sidecars left behind.
  const dir = dirname(lockPath);
  const leaked = fs.readdirSync(dir).filter((f) => f.includes(".stale."));
  assert.deepEqual(leaked, [], "no .stale. sidecar should leak after a clean steal");
  releaseStateLock(lock);
});

test("M-01: the steal removes only the stale inode, never a fresh lock that replaced it", () => {
  const p = tmpStatePath();
  const lockPath = p + ".lock";
  // Stale lock present at stat time (mtime well past the threshold).
  fs.writeFileSync(lockPath, "12345");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, old, old);

  // TOCTOU race model: a live writer replaces the lock with a BRAND-NEW lock
  // (current mtime) the instant our code renames the stale one away. We patch
  // renameSync so the live lock appears in the now-empty slot during the steal.
  // The rename-based steal operates on the renamed sidecar (the exact inode it
  // moved), so it must NOT delete the fresh "88888" lock sitting at lockPath.
  let raced = false;
  const origRename = fs.renameSync;
  const patched = (from: fs.PathLike, to: fs.PathLike) => {
    origRename(from, to);
    if (!raced && String(from) === lockPath) {
      raced = true;
      fs.writeFileSync(lockPath, "88888"); // live writer wins the empty slot
    }
  };
  (fs as { renameSync: typeof fs.renameSync }).renameSync = patched as typeof fs.renameSync;
  // Constant real-now clock: iteration 1 sees the backdated lock as stale (steal),
  // iteration 2 sees the fresh "88888" lock as NOT stale. We abort via sleep() so
  // the loop halts right after iteration 1's steal — letting us assert that the
  // freshly-placed live lock survived that single steal iteration uncloberred.
  const realNow = Date.now();
  class HaltAfterSteal extends Error {}
  const clock: Clock = {
    now: () => realNow,
    sleep: () => {
      throw new HaltAfterSteal();
    },
  };
  try {
    try {
      acquireStateLock(p, clock);
    } catch (e) {
      if (!(e instanceof HaltAfterSteal)) throw e;
    }
    // The live writer's fresh lock body survived the steal (its inode was never
    // the one the steal renamed/unlinked). Pre-fix (blind unlink) this would be gone.
    assert.equal(fs.readFileSync(lockPath, "utf8"), "88888", "fresh live lock not clobbered");
  } finally {
    (fs as { renameSync: typeof fs.renameSync }).renameSync = origRename;
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
});

test("M-02: missing parent directory fails fast with a clear error (not budget spin)", () => {
  // statePath whose parent dir does not exist → O_EXCL create yields ENOENT.
  const missing = join(os.tmpdir(), "gsd-oc-nonexistent-" + Date.now(), "sub", "STATE.md");
  const clock = fakeClock(0);
  assert.throws(
    () => acquireStateLock(missing, clock),
    /parent directory .* does not exist/,
    "ENOENT must fail fast with a directory-missing error",
  );
  // Fail-fast means no budget spin: the fake clock never advanced via sleep.
  assert.equal(clock.now(), 0, "must not have spin-waited the full budget on ENOENT");
});

test("readState re-exported from state.ts parses the engine-state fixture identically", async () => {
  const p = tmpStatePath();
  const s = await readState(dirname(p));
  assert.equal(s.current_phase, 2);
  assert.equal(s.total_phases, 7);
  assert.equal(s.current_phase_name, "Native State Engine");
});
