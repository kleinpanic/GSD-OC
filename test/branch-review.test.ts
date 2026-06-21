import { test } from "node:test";
import assert from "node:assert/strict";
import { branchNameFor, createWorkBranch } from "../src/engine/branch.js";
import { resolveReviewer, crossAiReview, convergeReview, type ReviewFinding, type Reviewer } from "../src/orchestrate/cross-ai-review.js";

test("branch: name resolution honors strategy + templates", () => {
  assert.equal(branchNameFor({ branching_strategy: "none" }, "phase", { phase: "1", slug: "auth" }), null);
  assert.equal(branchNameFor({ branching_strategy: "phase" }, "phase", { phase: "1", slug: "Add Auth!" }), "gsd/phase-1-add-auth");
  assert.equal(branchNameFor({ branching_strategy: "phase" }, "milestone", { milestone: "v1" }), null, "phase strategy ignores milestone op");
  assert.equal(branchNameFor({ branching_strategy: "milestone" }, "milestone", { milestone: "v1.1", slug: "core" }), "gsd/v1-1-core");
  assert.equal(branchNameFor({ branching_strategy: "quick" }, "quick", { slug: "tweak" }), "gsd/quick-tweak");
});

test("branch: createWorkBranch dryRun emits safe argv; none → no-op", () => {
  assert.deepEqual(createWorkBranch("/r", { branching_strategy: "none" }, "phase", {}), { argv: [], ok: true, branch: null });
  const r = createWorkBranch("/r", { branching_strategy: "phase" }, "phase", { phase: "2", slug: "x" }, { dryRun: true });
  assert.equal(r.branch, "gsd/phase-2-x");
  assert.deepEqual(r.argv[0], ["switch", "-c", "gsd/phase-2-x", "HEAD"]);
});

test("cross-ai: reviewer resolution (model-ref vs ACP agentId)", () => {
  assert.deepEqual(resolveReviewer("glm/glm-4.6"), { id: "glm/glm-4.6", modelRef: "glm/glm-4.6" });
  assert.deepEqual(resolveReviewer("glm", { glm: "glm/glm-4.6" }), { id: "glm", modelRef: "glm/glm-4.6" });
  assert.deepEqual(resolveReviewer("codex"), { id: "codex", modelRef: undefined }, "bare → ACP harness agentId");
});

test("cross-ai: aggregates findings + counts HIGH", async () => {
  const reviewers: Reviewer[] = [{ id: "glm" }, { id: "codex" }];
  const dispatch = async (r: Reviewer): Promise<ReviewFinding[]> =>
    r.id === "glm" ? [{ reviewer: "glm", severity: "high", text: "race" }] : [{ reviewer: "codex", severity: "low", text: "nit" }];
  const v = await crossAiReview(reviewers, "plan", dispatch);
  assert.equal(v.findings.length, 2);
  assert.equal(v.highCount, 1);
});

test("cross-ai: converges when fixes clear the HIGH findings", async () => {
  let fixed = false;
  const reviewers: Reviewer[] = [{ id: "glm" }];
  const dispatch = async (): Promise<ReviewFinding[]> => (fixed ? [] : [{ reviewer: "glm", severity: "high", text: "bug" }]);
  const r = await convergeReview(reviewers, () => "plan", dispatch, async () => { fixed = true; }, { maxRounds: 3 });
  assert.ok(r.converged);
  assert.equal(r.rounds, 2, "round 1 finds HIGH+fixes, round 2 clean");
});
