/**
 * ENG-01 intent classifier (D-01). Pure function — no fs, no Date, no env reads.
 *
 * Category provenance is the GSD `do.md` routing table (do.md:41-62):
 *   - new-project : "set up", "initialize" a new project           (do.md:43)
 *   - map         : map/analyze an existing codebase                (do.md:44)
 *   - debug       : a bug, error, crash, failure, something broken  (do.md:45)
 *   - phase       : refactor / migration / multi-file architecture  (do.md:52)
 *   - plan        : "plan phase N"                                  (do.md:53)
 *   - execute     : "execute / build / run phase N"                 (do.md:54)
 *   - quick       : a specific, actionable, small task              (do.md:62)
 *   - chat        : greetings / standalone informational questions  (skip; not in table)
 *
 * Matching is case-insensitive against a single lowercased, trimmed copy of the prompt.
 */

export type IntentResult = { engage: boolean; category: string; reason: string };

const CHAT: IntentResult = { engage: false, category: "chat", reason: "chat/quick one-off — no GSD work verb" };

/** Greetings / pleasantries that are pure chat regardless of anything else. */
const GREETING_RE = /^(hi|hello|hey|yo|sup|thanks|thank you|good (morning|afternoon|evening|night)|how are you|how's it going)\b/;

/** Work-verb → do.md category. Order matters: first match wins for overlapping phrases. */
const RULES: Array<{ re: RegExp; category: string; reason: string }> = [
  // new-project (do.md:43)
  { re: /\b(set up|setup|initiali[sz]e|bootstrap|scaffold)\b/, category: "new-project", reason: "new-project setup verb (do.md:43)" },
  // map (do.md:44)
  { re: /\bmap\b.*\b(codebase|repo|project)\b|\bmap the\b/, category: "map", reason: "codebase mapping (do.md:44)" },
  // debug (do.md:45)
  { re: /\b(debug|crash|error|failure|broken|broke|stack ?trace|exception|regression)\b/, category: "debug", reason: "bug/error/crash signal (do.md:45)" },
  // plan (do.md:53)
  { re: /\bplan\b.*\bphase\b|\bplan phase\b/, category: "plan", reason: "phase planning (do.md:53)" },
  // execute (do.md:54)
  { re: /\b(execute|run)\b.*\bphase\b/, category: "execute", reason: "phase execution (do.md:54)" },
  // phase — multi-file architecture / refactor / migration / redesign (do.md:52)
  { re: /\b(refactor|migrat(e|ion)|redesign|re-?architect|architecture|the (system|whole|entire))\b/, category: "phase", reason: "multi-file architecture/refactor/migration (do.md:52)" },
  // phase — substantial build verbs (feature/api/service)
  { re: /\b(build|implement|create|develop|design)\b/, category: "phase", reason: "coding/big-work build verb (do.md:52/62)" },
  // quick — specific actionable small task (do.md:62)
  { re: /\b(add|update|change|remove|delete|rename|tweak|adjust|wire|hook up|fix)\b/, category: "quick", reason: "specific actionable task (do.md:62)" },
  // quick — generic work phrasing
  { re: /\b(do|make|work)\b/, category: "quick", reason: "actionable work verb (do.md:62)" },
];

export function classifyIntent(prompt: string): IntentResult {
  const text = (prompt ?? "").trim().toLowerCase();
  if (text.length === 0) return CHAT;
  if (GREETING_RE.test(text)) return CHAT;

  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return { engage: true, category: rule.category, reason: rule.reason };
    }
  }

  // No work verb matched → standalone question / chatter → skip.
  return CHAT;
}
