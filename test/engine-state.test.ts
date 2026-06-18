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

test("readState re-exported from state.ts parses the engine-state fixture identically", async () => {
  const p = tmpStatePath();
  const s = await readState(dirname(p));
  assert.equal(s.current_phase, 2);
  assert.equal(s.total_phases, 7);
  assert.equal(s.current_phase_name, "Native State Engine");
});
