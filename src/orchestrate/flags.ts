/**
 * Flags-as-a-layer-of-intent. GSD commands take flags/args (`--all`, `--research`, `--forensic`, `--auto`,
 * `--from N --to M`, `--reviews`) that change WHAT the same command does. A coding intent often implies the
 * flag — "review everything" ⇒ `gsd-review --all`, "research it first" ⇒ `--research`, "deep audit" ⇒
 * `--forensic`. This maps free-text intent → the GSD flags that realize it, so intent drives both the command
 * AND its arguments (not just the command).
 */

export interface FlagRule {
  re: RegExp;
  flag: string;
  /** commands this flag is valid for; empty = any. */
  commands?: string[];
}

/** Intent-keyword → flag rules (ordered; all matching rules apply). Grounded in the real upstream flag set. */
export const FLAG_RULES: FlagRule[] = [
  { re: /\b(all|everything|entire|every (phase|file|skill)|across the board|comprehensive(ly)?|full (sweep|audit))\b/i, flag: "--all" },
  { re: /\b(research|investigate|look into|study|dig into)\b.*\b(first|before)\b|\bresearch-first\b|\bresearch first\b/i, flag: "--research" },
  { re: /\b(forensic\w*|deep\w*|thorough\w*|rigorous\w*|integrity|6-?check|exhaustive)\b/i, flag: "--forensic" },
  { re: /\b(auto(nomous(ly)?|matic(ally)?)?|no gate|skip (the )?gates?|don'?t (stop|ask)|hands?-?off)\b/i, flag: "--auto" },
  { re: /\b(cross-?ai|peer review|re-?plan(ning)?|another (ai|model) review)\b/i, flag: "--reviews" },
  { re: /\b(fix|auto-?fix|apply (the )?fixes|remediat\w*)\b/i, flag: "--fix", commands: ["code-review", "audit-fix"] },
];

/** Extract `--from N` / `--to M` when the intent names a phase range ("from phase 2 to 5", "phases 3-7"). */
function rangeFlags(intent: string): string[] {
  const out: string[] = [];
  const from = /\b(?:from|starting (?:at|from))\s+(?:phase\s+)?(\d+(?:\.\d+)?)\b/i.exec(intent);
  const to = /\b(?:to|through|until|up to)\s+(?:phase\s+)?(\d+(?:\.\d+)?)\b/i.exec(intent);
  const dash = /\bphases?\s+(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\b/i.exec(intent);
  if (dash) return [`--from ${dash[1]}`, `--to ${dash[2]}`];
  if (from) out.push(`--from ${from[1]}`);
  if (to) out.push(`--to ${to[1]}`);
  return out;
}

/**
 * Suggest the GSD flags implied by an intent (optionally scoped to a specific command). Deterministic,
 * de-duplicated, order-stable. `command` filters command-specific rules; the generic rules always apply.
 */
export function suggestFlags(intent: string, command?: string): string[] {
  const text = (intent ?? "").slice(0, 8192);
  const flags = new Set<string>();
  for (const r of FLAG_RULES) {
    if (r.commands && command && !r.commands.includes(command)) continue;
    if (r.re.test(text)) flags.add(r.flag);
  }
  for (const f of rangeFlags(text)) flags.add(f);
  return [...flags];
}
