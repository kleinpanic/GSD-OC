import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  decideBootstrapInjection,
  gsdBootstrapHandler,
  type AgentBootstrapContext,
  type WorkspaceBootstrapFile,
} from "../src/engage/bootstrap-inject.js";

// A real project path follows the machine's convention: codeWS/<Lang>/<Project> (depth-2).
const codeWS = join(homedir(), "codeWS", "JavaScript", "SomeProject");

function agentsFile(content = ""): WorkspaceBootstrapFile {
  return { name: "AGENTS", path: join(codeWS, "AGENTS.md"), content, missing: content === "" };
}
function ctx(over: Partial<AgentBootstrapContext> = {}): AgentBootstrapContext {
  return { workspaceDir: codeWS, bootstrapFiles: [agentsFile("# AGENTS.md\n\n## House\n- be terse\n")], ...over };
}

test("injects the GSD policy leading the AGENTS content for a coding workspace", () => {
  const c = ctx();
  const d = decideBootstrapInjection(c);
  assert.ok(d, "expected an injection decision");
  assert.ok(d!.content.includes("gsd-oc:begin"));
  assert.ok(d!.content.includes("gsd_workflow"));
  // GSD block leads the seeded persona.
  assert.ok(d!.content.indexOf("gsd-oc:begin") < d!.content.indexOf("## House"));
});

test("handler mutates bootstrapFiles in place (runtime reads it back)", () => {
  const event = { context: ctx() };
  gsdBootstrapHandler(event);
  const agents = event.context.bootstrapFiles.find((f) => f.name === "AGENTS");
  assert.ok(agents?.content?.includes("[GSD auto-engaged]"));
  assert.equal(agents?.missing, false);
});

test("synthesizes an AGENTS entry when none exists", () => {
  const event = { context: ctx({ bootstrapFiles: [] }) };
  gsdBootstrapHandler(event);
  assert.equal(event.context.bootstrapFiles.length, 1);
  assert.ok(event.context.bootstrapFiles[0].content?.includes("gsd-oc:begin"));
});

test("does NOT inject outside a coding workspace", () => {
  assert.equal(decideBootstrapInjection(ctx({ workspaceDir: "/tmp/random" })), null);
});

test("is idempotent — does not double-inject if the block is already present", () => {
  const c = ctx();
  const first = decideBootstrapInjection(c)!;
  c.bootstrapFiles[0] = { ...c.bootstrapFiles[0], content: first.content };
  assert.equal(decideBootstrapInjection(c), null, "second pass is a no-op");
});

test("respects the pluginConfig opt-out (c)", () => {
  const c = ctx({ cfg: { plugins: { entries: { "gsd-oc": { config: { disabled: true } } } } } });
  assert.equal(decideBootstrapInjection(c), null);
});

test("reuses canonical merge: existing '# AGENTS.md' title stays the first line (WR-03)", () => {
  const c = ctx({ bootstrapFiles: [agentsFile("# AGENTS.md\n\nHost persona\n")] });
  const d = decideBootstrapInjection(c)!;
  assert.ok(d.content.startsWith("# AGENTS.md"), "title must remain the first line");
  assert.ok(d.content.includes("Host persona"), "host persona preserved");
  assert.ok(
    d.content.indexOf("gsd-oc:begin") > d.content.indexOf("# AGENTS.md"),
    "GSD block sits after the title, not before it",
  );
});

test("double-invoke on the same bootstrapFiles yields exactly ONE GSD block (WR-03)", () => {
  const beginRe = /gsd-oc:begin/g;
  const event = { context: ctx({ bootstrapFiles: [agentsFile("# AGENTS.md\n\nHost persona\n")] }) };
  gsdBootstrapHandler(event);
  gsdBootstrapHandler(event); // second pass must be a no-op (already injected)
  const agents = event.context.bootstrapFiles.find((f) => f.name === "AGENTS");
  assert.equal((agents?.content?.match(beginRe) || []).length, 1, "exactly one managed block");
});
