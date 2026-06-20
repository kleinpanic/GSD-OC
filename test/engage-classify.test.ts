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

test("greeting prefix does NOT swallow a real request (CR greeting-swallow)", () => {
  const r = classifyIntent("hi, please build X");
  assert.equal(r.engage, true, "remainder after greeting must classify");
  assert.equal(r.category, "phase", "build verb in remainder → phase");
});

test("gratitude stays chat even when it references built work", () => {
  const r = classifyIntent("thanks for building that");
  assert.equal(r.engage, false);
  assert.equal(r.category, "chat");
});

test("debug regex aligned: failure/bug/flaky/reproduce signals → debug (CR-01)", () => {
  for (const prompt of [
    "hey can you debug this error",
    "the parser fails",
    "the test is flaky",
    "there is a bug in checkout",
    "reproduce the issue",
  ]) {
    const r = classifyIntent(prompt);
    assert.equal(r.engage, true, `expected engage for "${prompt}"`);
    assert.equal(r.category, "debug", `expected debug for "${prompt}"`);
  }
});

test("'the build' noun in a question does NOT engage (WR-02 weak build rule)", () => {
  const r = classifyIntent("what does the build do?");
  assert.equal(r.engage, false);
  assert.equal(r.category, "chat");
});

test("'build a new service' (no question frame) still engages (WR-02 regression)", () => {
  const r = classifyIntent("build a new service");
  assert.equal(r.engage, true);
  assert.equal(r.category, "phase");
});

test("'how do I fix the build?' engages via the strong fix verb", () => {
  // Question frame suppresses weak build, but `fix` is a strong quick verb that survives.
  assert.equal(classifyIntent("how do I fix the build?").engage, true);
});

test("debug classification is case-insensitive (FIX THE BUG == fix the bug)", () => {
  assert.deepEqual(classifyIntent("FIX THE BUG"), classifyIntent("fix the bug"));
});
