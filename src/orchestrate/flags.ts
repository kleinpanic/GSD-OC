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
  // Planning-mode flags
  { re: /\b(tdd|test-?driven|red-?green|test first)\b/i, flag: "--tdd", commands: ["plan-phase", "execute-phase"] },
  { re: /\b(mvp|minimum viable|bare ?bones|simplest thing)\b/i, flag: "--mvp", commands: ["plan-phase", "execute-phase"] },
  { re: /\b(power mode|maximum|max effort|go hard|deep plan)\b/i, flag: "--power", commands: ["discuss-phase"] },
  { re: /\b(batch|all at once|in bulk|multiple at once)\b/i, flag: "--batch", commands: ["discuss-phase"] },
  { re: /\b(analyze|analysis|assess (the )?codebase)\b/i, flag: "--analyze", commands: ["discuss-phase"] },
  { re: /\b(assumptions?|what (am i|are we) assuming|surface (the )?assumptions?)\b/i, flag: "--assumptions", commands: ["discuss-phase"] },
  { re: /\b(coarse|high-?level|fine-?grained|granular(ity)?|small (steps|chunks))\b/i, flag: "--granularity", commands: ["plan-phase"] },
  { re: /\b(plan-?bounce|bounce (the )?plan|iterate (the )?plan)\b/i, flag: "--bounce", commands: ["plan-phase"] },
  { re: /\b(gaps?|coverage gap|missing (coverage|requirements?)|uncovered)\b/i, flag: "--gaps", commands: ["plan-phase", "execute-phase"] },
  { re: /\b(prd|product requirements?|spec(ification)? (doc|file)|from (the )?spec)\b/i, flag: "--prd", commands: ["plan-phase"] },
  // Execution / verification / ship flags
  { re: /\bwave\s+\d+\b|\bin (parallel )?waves?\b/i, flag: "--wave", commands: ["execute-phase"] },
  { re: /\b(interactiv\w*|step ?by ?step|ask me|prompt me|walk me through)\b/i, flag: "--interactive", commands: ["execute-phase", "verify-work"] },
  { re: /\b(draft|wip|work in progress|not ready)\b/i, flag: "--draft", commands: ["ship"] },
  // Repair / backfill / context (the maintenance flags)
  { re: /\b(repair|recover|fix (the )?state|heal)\b/i, flag: "--repair", commands: ["next", "resume-work"] },
  { re: /\b(backfill|fill in (the )?(gaps|missing)|retroactive\w*|after the fact)\b/i, flag: "--backfill" },
  { re: /\b(context|more context|gather context|with context)\b/i, flag: "--context", commands: ["discuss-phase"] },
];

/** Extract `--wave N` when the intent names a wave number ("execute wave 2"). */
function waveFlag(intent: string): string[] {
  const m = /\bwave\s+(\d+)\b/i.exec(intent);
  return m ? [`--wave ${m[1]}`] : [];
}

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
  // --wave N carries its number; replace the bare --wave with the numbered form when present.
  const wave = waveFlag(text);
  if (wave.length) {
    flags.delete("--wave");
    for (const w of wave) flags.add(w);
  }
  return [...flags];
}
