import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { detectGsdInstall, safeList, isDenied, candidateRoots } from "../src/retrieval/detect.js";

function plantInstall(): { home: string; faux: string } {
  const home = mkdtempSync(join(tmpdir(), "gsd-detect-"));
  const faux = join(home, ".faux");
  const core = join(faux, "gsd-core");
  mkdirSync(join(core, "workflows"), { recursive: true });
  mkdirSync(join(core, "references"), { recursive: true });
  mkdirSync(join(core, "templates", "sub"), { recursive: true });
  mkdirSync(join(faux, "agents"), { recursive: true });
  writeFileSync(join(core, "workflows", "a.md"), "# a");
  writeFileSync(join(core, "references", "b.md"), "# b");
  writeFileSync(join(core, "templates", "sub", "c.md"), "# c");
  writeFileSync(join(faux, "agents", "gsd-x.md"), "# x");
  // planted sensitive files
  writeFileSync(join(core, "workflows", ".Xauthority"), "secret");
  mkdirSync(join(core, ".ssh"), { recursive: true });
  writeFileSync(join(core, ".ssh", "id_rsa"), "secret");
  writeFileSync(join(faux, "agents", ".bash_history"), "secret");
  return { home, faux };
}

test("detectGsdInstall finds a planted install via a custom CLI home override", () => {
  const { home, faux } = plantInstall();
  try {
    // point the `claude` candidate at .faux by using .faux's parent as home (.claude won't exist there)
    // instead override via CURSOR_CONFIG_DIR which maps directly to a root.
    const env = { CURSOR_CONFIG_DIR: faux } as NodeJS.ProcessEnv;
    const found = detectGsdInstall(env, home);
    assert.ok(found, "expected an install");
    assert.equal(found!.cli, "cursor");
    assert.equal(found!.root, faux);
    assert.equal(found!.docRoots.length, 4);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("snapshot file-list is allow-list ∩ deny-list: only .md inside doc roots, no sensitive files", () => {
  const { home, faux } = plantInstall();
  try {
    const env = { CURSOR_CONFIG_DIR: faux } as NodeJS.ProcessEnv;
    const found = detectGsdInstall(env, home)!;
    const all: string[] = [];
    for (const d of found.docRoots) {
      const files = safeList(d.root, d.recursive).filter((f) =>
        d.kind === "agent" ? basename(f).startsWith("gsd-") && f.endsWith(".md") : f.endsWith(".md"),
      );
      all.push(...files);
    }
    // every emitted path is a .md
    assert.ok(all.every((f) => f.endsWith(".md")), "non-.md emitted");
    // none of the planted sensitive files present
    assert.ok(!all.some((f) => basename(f) === ".Xauthority"), ".Xauthority leaked");
    assert.ok(!all.some((f) => basename(f) === "id_rsa"), "id_rsa leaked");
    assert.ok(!all.some((f) => basename(f) === ".bash_history"), ".bash_history leaked");
    // every path lives under one of the doc roots
    const roots = found.docRoots.map((d) => d.root);
    assert.ok(all.every((f) => roots.some((r) => f.startsWith(r))), "path outside doc roots");
    // the four legit docs are present
    assert.equal(all.length, 4);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("safeList does not descend into denied dirs", () => {
  const { home, faux } = plantInstall();
  try {
    const list = safeList(join(faux, "gsd-core"), true);
    assert.ok(!list.some((f) => f.includes("/.ssh/")), "descended into .ssh");
    assert.ok(!list.some((f) => basename(f) === "id_rsa"), "emitted id_rsa");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("isDenied unit cases", () => {
  assert.equal(isDenied(".Xauthority"), true);
  assert.equal(isDenied("id_rsa"), true);
  assert.equal(isDenied(".bash_history"), true);
  assert.equal(isDenied(".env"), true);
  assert.equal(isDenied("id_ed25519.pem"), true);
  assert.equal(isDenied("plan-phase.md"), false);
  assert.equal(isDenied("gsd-executor.md"), false);
});

test("candidateRoots honors $CODEX_HOME override and dedupes", () => {
  const env = { CODEX_HOME: "/custom/codex" } as NodeJS.ProcessEnv;
  const cands = candidateRoots(env, "/home/u");
  const codex = cands.find((c) => c.cli === "codex");
  assert.equal(codex!.root, "/custom/codex");
  const claude = cands.find((c) => c.cli === "claude");
  assert.equal(claude!.root, "/home/u/.claude");
});
