/**
 * The fixed A/B benchmark task set. Each task is replayable: a band, the exact prompt, the expected GSD subagents
 * (the M3 label), the gates that must fire, whether it should stay inline (M7 trivial discipline), and a Done
 * predicate. The harness runs each task with GSD-on and GSD-off, captures both arms' traces, and computes the
 * per-band deltas. 14 tasks across 7 bands.
 */
import type { Band } from "./types.js";

export interface BenchTask {
  id: string;
  band: Band;
  prompt: string;
  expectSubagents: string[];
  expectGates: string[];
  trivialInline: boolean;
}

export const BENCH_TASKS: BenchTask[] = [
  { id: "t-typo", band: "trivial", prompt: "fix the typo in README line 4", expectSubagents: [], expectGates: [], trivialInline: true },
  { id: "t-rename", band: "trivial", prompt: "rename the variable foo to bar in x.ts", expectSubagents: [], expectGates: [], trivialInline: true },
  { id: "s-util", band: "simple", prompt: "add a clamp(n,lo,hi) util with a test", expectSubagents: ["gsd-executor"], expectGates: [], trivialInline: false },
  { id: "s-doc", band: "docs", prompt: "document the retrieval module", expectSubagents: ["gsd-doc-writer"], expectGates: [], trivialInline: false },
  { id: "c-ratelimit", band: "complex", prompt: "build a rate-limiter middleware, planned", expectSubagents: ["gsd-planner", "gsd-executor", "gsd-verifier"], expectGates: ["plan", "verify"], trivialInline: false },
  { id: "c-split", band: "complex", prompt: "split the god-module into three, with a plan", expectSubagents: ["gsd-planner", "gsd-executor", "gsd-code-reviewer", "gsd-verifier"], expectGates: ["plan", "verify"], trivialInline: false },
  { id: "a-oauth", band: "auth", prompt: "add OAuth + JWT login to the API", expectSubagents: ["gsd-planner", "gsd-executor", "gsd-security-auditor"], expectGates: ["plan", "verify"], trivialInline: false },
  { id: "a-reset", band: "auth", prompt: "add a password reset flow", expectSubagents: ["gsd-planner", "gsd-executor", "gsd-security-auditor"], expectGates: ["plan"], trivialInline: false },
  { id: "ai-eval", band: "ai", prompt: "integrate an LLM and design its eval strategy", expectSubagents: ["gsd-framework-selector", "gsd-eval-planner"], expectGates: ["ai-integration"], trivialInline: false },
  { id: "ai-rag", band: "ai", prompt: "build a RAG pipeline with guardrails", expectSubagents: ["gsd-eval-planner"], expectGates: ["ai-integration"], trivialInline: false },
  { id: "d-flaky", band: "debug", prompt: "the build is flaky, CI fails intermittently", expectSubagents: ["gsd-debugger"], expectGates: [], trivialInline: false },
  { id: "d-repro", band: "debug", prompt: "the deploy broke and I can't reproduce it", expectSubagents: ["gsd-debugger"], expectGates: [], trivialInline: false },
  { id: "x-secure-ui", band: "complex", prompt: "build a secure frontend login form", expectSubagents: ["gsd-ui-researcher", "gsd-security-auditor"], expectGates: ["ui", "verify"], trivialInline: false },
  { id: "x-spike-ui", band: "complex", prompt: "spike an AI feature then build its UI", expectSubagents: ["gsd-executor"], expectGates: ["ui"], trivialInline: false },
];
