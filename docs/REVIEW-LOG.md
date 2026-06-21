# GSD-OC — Recursive Review Log (2026-06-20)

Adversarial multi-agent review rounds (opus reviewers vs the codebase), each round fixing findings then
re-reviewing. Goal: drive CRITICAL/HIGH findings to zero. "Perfect" is asymptotic — adversarial review can
always surface lower-severity items; the convergence criterion is **no CRITICAL/HIGH for a full round**.

## Round trajectory

| Round | Focus | Top severity | Bugs fixed | Tests |
|---|---|---|---|---|
| 1–2 | enforcement + state keystones; retrieval/port verify | — | ~12 | 297 |
| 3 | enforce/mutate/config concrete bugs | **CRITICAL** (spawn contamination) | 11 | 325 |
| 4 | re-review fixes + un-audited modules | HIGH (prototype pollution) | 7 | 334 |
| 5 | re-review + last modules (commit/state/vectors/scripts) | **CRITICAL** (gate-skip) | 7 | 338 |
| 6 | regression + holistic cross-cutting | BLOCKER (security-gate auth coverage) | 3 | 340 |
| 7 | convergence re-check | HIGH (bold PASS verdict false-neg) | 1 | 341 |
| 8 | route state-machine sweep | HIGH (bold FAIL verdict reader asymmetry) | 1 | 342 |
| 9 | **convergence confirmed** | **none CRITICAL/HIGH** | 1 (WARNING) | 342 |

By Round 5 the whole codebase had been audited at least once. commit.ts confirmed shell-injection-free;
state.ts lock core confirmed TOCTOU-safe; retrieval RRF math confirmed correct. Round 6 confirmed the
integration flows sound (state write→read, model routing, project-detection, manifest-triple) and fixed
the secure-gate auth-coverage blocker (OAuth/password/jwt now threat-modeled). Rounds 7-8 fixed the bold-verdict (`**Status:**`) handling on both the PASS and FAIL readers (they were
asymmetric). **Round 9 CONVERGED**: the three verdict readers are mutually symmetric, the broad sweep found
no CRITICAL/HIGH, only one WARNING (orchestrate execute un-try-wrapped) which was then closed. 342 tests.

## Accepted-risk / tracked (not fixed — low value vs. risk, or needs a larger change)

- **MED-03 (auto-advance infinite-revise)**: the `before_agent_finalize` revise loop could re-propose the same
  (phase, action) if the host's idempotencyKey is per-turn. Hook is INERT by default (operator must enable
  `allowConversationAccess`) and bounded by the host `maxAttempts:2`. A stateful dedup guard in a pure hook is
  over-engineering for an inert path — revisit if the hook is enabled by default.
- **LOW-02 (STATE.md symlink write)**: `writeFileSync(statePath)` follows a symlink at STATE.md. Requires prior
  write access to the planning dir; the lock create itself is O_EXCL-safe. Low likelihood; add `O_NOFOLLOW`/lstat
  if STATE.md ever lives in a world-writable dir.
- **LOW-05 (auto-engage marker breadth)**: the coding-marker walk fires for any dir beneath a `.git`/`package.json`.
  Intentionally broad; `classifyIntent` is the real backstop (chat intents don't engage). By design.
- **IN-02 (PASS/FAIL scanner asymmetry)**: route.ts PASS and FAIL scanners anchor slightly differently. No
  correctness defect (both correct for all tested inputs); unify only if refactoring.

## SDK-integration backlog (M7, from the SDK audit) — tracked in REQUIREMENTS.md
SDK-01 session_start bootstrap · SDK-02 live opt-out read-back · SDK-03 agent_end state-advance (the robust fix
for the cwd-scoping best-effort) · SDK-04 subagent telemetry · CFG-03 config breadth (26→107 keys).
