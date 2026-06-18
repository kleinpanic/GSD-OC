import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * PLUG-03: the runtime dependency tree must carry no Claude-Code / Anthropic / opengsd
 * dependency. We walk the *production* tree (npm ls --omit=dev) and assert the forbidden
 * scoped namespaces are absent. `openclaw` is a peer/dev dep, not a runtime dep here.
 */
test("no @anthropic-ai/* or @opengsd/* in the production dependency tree (PLUG-03)", () => {
  let out = "";
  try {
    out = execFileSync("npm", ["ls", "--all", "--omit=dev", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e: unknown) {
    // npm ls exits non-zero on peer warnings; its stdout JSON is still valid.
    out = (e as { stdout?: string }).stdout ?? "";
  }
  assert.ok(out.length > 0, "npm ls produced no output");
  assert.ok(!/@anthropic-ai\//.test(out), "found a forbidden @anthropic-ai/* dependency");
  assert.ok(!/@opengsd\//.test(out), "found a forbidden @opengsd/* dependency");
});
