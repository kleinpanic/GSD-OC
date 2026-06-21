/**
 * OCT-W4 — native security boundary guards (port of security.cjs). Reusable checks for the points where GSD-OC
 * touches the filesystem or shells out: path-containment (no traversal outside a root), shell-arg safety (no
 * injection sink), and a light prompt-injection scanner for untrusted text the plugin might surface to an agent.
 */
import path from "node:path";

/** True iff `target` resolves to `root` or a descendant of it (no `../` escape, symlink-naive — caller lstat's). */
export function isWithinRoot(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(root, target);
  return t === r || t.startsWith(r + path.sep);
}

/** Throw if `target` escapes `root`. Use before any write derived from untrusted input. */
export function assertWithinRoot(root: string, target: string): string {
  if (!isWithinRoot(root, target)) throw new Error(`path escapes root: ${JSON.stringify(target)}`);
  return path.resolve(root, target);
}

/** A shell-unsafe arg = empty, a leading-dash (flag injection), or a shell metachar. We never build shell
 *  STRINGS (argv arrays only), so metachars are inert at exec — this guards arg-as-flag injection + bad paths. */
const SHELL_META = /[;&|`$(){}<>\n\r"'\\*?~!#]/;
export function isSafeArg(arg: string): boolean {
  return typeof arg === "string" && arg.length > 0 && !arg.startsWith("-") && !SHELL_META.test(arg);
}

/** Light prompt-injection scan for untrusted text (corpus snippets, external review output) before it's woven
 *  into an agent message. Returns the matched directive-injection markers (empty = clean). Detection-only. */
const INJECTION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bignore (all |the )?(previous|prior|above) (instructions|prompts?|context)\b/i, label: "ignore-previous-instructions" },
  { re: /\b(disregard|forget) (all |everything )?(your |the )?(rules|instructions|system prompt)\b/i, label: "disregard-rules" },
  { re: /\byou are now\b.*\b(unrestricted|jailbroken|developer mode|do anything)\b/i, label: "role-override" },
  { re: /\b(system|assistant)\s*:\s*you (must|will|should)\b/i, label: "fake-system-turn" },
  { re: /\bexfiltrat\w+|send (the )?(secrets?|tokens?|credentials?|env(ironment)?) to\b/i, label: "exfiltration" },
];
export function scanInjection(text: string): string[] {
  const t = (text ?? "").slice(0, 100_000);
  return INJECTION_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.label);
}
