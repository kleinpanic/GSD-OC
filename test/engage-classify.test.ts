import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/engage/classify.js";

/**
 * ENG-01 classifier truth table, derived from the do.md routing table (do.md:41-62).
 * Coding / big-work prompts engage; chat / quick one-offs skip.
 */

const ENGAGE_CASES: Array<[string, string]> = [
  ["refactor the authentication system", "phase"],
  ["build a new payment feature", "phase"],
  ["implement the rate limiter", "phase"],
  ["create the API", "phase"],
  ["debug the crash on startup", "debug"],
  ["fix the broken login error", "debug"],
  ["plan phase 3", "plan"],
  ["execute phase 2", "execute"],
  ["run phase 4", "execute"],
  ["set up a new project", "new-project"],
  ["initialize the repo", "new-project"],
  ["map the codebase", "map"],
  ["add a delete button to the settings page", "quick"],
  ["do work", "quick"],
];

const SKIP_CASES: string[] = [
  "hi",
  "hello",
  "hey",
  "thanks",
  "good morning",
  "how are you",
  "what's the weather",
  "what is a closure in JS?",
  "",
  "   ",
  // L-01: incidental-keyword false-positives that must NOT auto-engage.
  "explain the system call",
  "what does the system call do",
  "how does the event loop work",
  "what do you think about rust",
  "how do you make a closure in JS?",
];

test("classifyIntent engages coding/big-work prompts (ENG-01)", () => {
  for (const [prompt, category] of ENGAGE_CASES) {
    const r = classifyIntent(prompt);
    assert.equal(r.engage, true, `expected engage=true for "${prompt}"`);
    assert.equal(r.category, category, `expected category "${category}" for "${prompt}"`);
    assert.ok(r.reason.length > 0, `expected a reason for "${prompt}"`);
  }
});

test("classifyIntent skips chat/quick one-offs (ENG-01)", () => {
  for (const prompt of SKIP_CASES) {
    const r = classifyIntent(prompt);
    assert.equal(r.engage, false, `expected engage=false for "${prompt}"`);
    assert.equal(r.category, "chat", `expected category "chat" for "${prompt}"`);
  }
});

test("classifyIntent is deterministic and case-insensitive", () => {
  assert.deepEqual(
    classifyIntent("REFACTOR The Auth System"),
    classifyIntent("refactor the auth system"),
  );
  assert.deepEqual(classifyIntent("hi"), classifyIntent("hi"));
});
