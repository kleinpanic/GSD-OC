import { test } from "node:test";
import assert from "node:assert/strict";
import { cmpSemver } from "../src/version.js";

test("cmpSemver: numeric core + pre-release ordering; throws on non-semver (drift gate, BLOCKER)", () => {
  assert.equal(cmpSemver("1.4.5", "1.4.10-rc1"), -1, "installed 1.4.5 BEHIND a newer pre-release upstream");
  assert.equal(cmpSemver("1.4.10", "1.4.10-rc1"), 1, "release outranks its pre-release");
  assert.equal(cmpSemver("v1.4.5", "1.4.5"), 0, "v-prefix tolerated");
  assert.equal(cmpSemver("2.0.0", "1.9.9"), 1);
  assert.equal(cmpSemver("1.4.5", "1.4.5"), 0);
  // the BLOCKER: a non-semver string must THROW, not fall back to a drift-masking lexicographic compare
  assert.throws(() => cmpSemver("1.4.5", "not-a-version"), /non-semver/);
});
