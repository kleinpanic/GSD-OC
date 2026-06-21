<!-- generated-by: gsd-doc-writer -->
# Contributing to GSD-OC

GSD-OC is an OpenClaw internal plugin that brings the GSD lifecycle (research → map →
plan → execute → verify → ship) natively into OpenClaw — no Claude Code in the loop.
Contributions are welcome. This guide covers setup, conventions, and the commit/PR norms
the repo enforces.

For a deeper tour of the project layout, build pipeline, generated artifacts, and testing
model, see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Prerequisites

- **Node.js `>=22`** — enforced by `package.json` `engines`. The build and test scripts
  use Node's native `--experimental-strip-types`, which requires a recent Node 22+.
- **npm** — the lockfile is `package-lock.json`.
- OpenClaw `>=2026.5.17` is a peer dependency; a pinned `openclaw` is installed as a
  devDependency for type resolution and `npx openclaw plugins build`.

## Setup

```bash
git clone https://github.com/kleinpanic/GSD-OC.git
cd GSD-OC
npm install
npm run build      # tsc -> dist/  then  node scripts/copy-artifacts.mjs
npm test           # tsc -p tsconfig.test.json  then  node --test (342 tests, node:test)
```

A clean `npm install && npm run build && npm test` is the baseline every change must keep
green. The test suite is built with `node:test` — no third-party runner.

> The retrieval artifacts (`corpus.generated.json`, `vectors.*`) are gitignored and not
> required to build or run the test suite. They are regenerated from a detected GSD install
> at build time — see `docs/DEVELOPMENT.md` for `build:corpus` and `build:vectors`.

## Build constraints (read before adding source)

The runtime build (`npm run build`) compiles with `tsc`, but two scripts
(`build:corpus`, `build:vectors`) run TypeScript directly under Node's
`--experimental-strip-types`. Strip-types performs **type erasure only** — it does not
emit code — which imposes two hard constraints on any `src/` code that those scripts import:

1. **No TypeScript parameter properties.** A constructor written as
   `constructor(private readonly x: T)` is rejected — strip-types cannot synthesize the
   field assignment. Declare the field explicitly and assign in the body instead.
2. **No `import "./x.js"` value imports when only `x.ts` exists.** Strip-types cannot
   resolve a `.js` specifier that has no emitted `.js` on disk. This is why
   `scripts/build-vectors.ts` imports from **`../dist/retrieval/*.js`** (the compiled
   output) rather than from `../src/retrieval/*.ts` — run `npm run build` before
   `npm run build:vectors`. Scripts that only touch type-only `src` imports
   (`build-corpus.ts`, `port-agents.ts`) use `import type` and the `.ts` source directly.

Keep these in mind when adding modules that the build scripts pull in.

## Conventions

- **TypeScript ESM.** `"type": "module"`, `module`/`moduleResolution` set to `NodeNext`,
  `strict: true`. Intra-`src` imports use the `.js` specifier (NodeNext resolution).
- **typebox for tool schemas.** Dynamic tool input/output schemas are declared with
  `typebox` (the only non-LanceDB runtime dependency). Do not introduce a parallel schema
  library.
- **The 0-Discord-slot rule.** Discord caps an account at 100 global slash commands. GSD-OC
  exposes its entire surface through `registerTool` + a small set of routers — it registers
  **zero** slash commands. `registerCommand` call count and the manifest `commands[]` count
  must both stay `0`. This is enforced by `test/slot-audit.test.ts`: the combined
  `globalSlashCommands` count is asserted `=== 0` and the registered-tool count is asserted
  `>= 7` and `<= 100`. Never add a `registerCommand` call or a `commands[]` entry to
  `openclaw.plugin.json`.
- **No forbidden runtime deps.** The production dependency tree must carry no
  `@anthropic-ai/*` or `@opengsd/*` package — enforced by `test/no-forbidden-deps.test.ts`
  (walks `npm ls --omit=dev`). OpenClaw stays a peer/dev dependency, never a runtime one.
- **Tests are required for non-trivial changes.** New behavior lands with a `node:test`
  test under `test/` (compiled into `dist-test/`). Trivial edits (cosmetic, docs-only,
  fewer than ~5 logical lines) are waived. The bar is: a behavior change without a test is
  not done.

## Commit and PR norms

- **GPG-signed commits.** All commits are signed. Do not change git config — the identity
  (`Klein Panic`, GPG-signed) is locked.
- **Conventional commit messages.** Use a `type(scope): summary` subject and explain
  *why* the change exists in the body, not just *what* changed. Example:
  `fix: act on cross-AI review — modality output, input guards, cwd activation`.
- **Stage specific files** by name. Do not `git add -A` or `git add .`.
- **Never `--no-verify`.** Do not skip git hooks.
- **Never force-push `main`.** Force-pushing the default branch requires explicit
  maintainer instruction.
- **Keep `.planning/` out of feature PR branches.** `.planning/` is the GSD working history
  (the plugin dogfoods GSD on itself — see below). It is committed to the repo but should
  not be bundled into unrelated feature PRs.

## The `.planning/` directory

`.planning/` is GSD-OC's own GSD lifecycle history — requirements, roadmap, per-phase plans
and summaries, the benchmark and scoring records, and the recursive-review log. The plugin
**dogfoods GSD on itself**: the project was built through the same research → plan → execute
→ verify → ship loop it implements. It is reference and provenance, not application code, and
is excluded from the published npm package (`.npmignore`).

## License

GSD-OC is MIT licensed. See [`LICENSE`](LICENSE). By contributing you agree your
contributions are licensed under the same terms.
