/**
 * Shared text normalization + tokenization for the lexical/trigram modalities.
 * Hyphen-joined ids (`gsd-debug`) emit BOTH the joined token and its split parts
 * (`gsd`, `debug`) so a plain-word query like "the build is flaky" can still reach
 * a doc whose id contains `debug` (RET-03/L7).
 */

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function tokenize(s: string): string[] {
  const out: string[] = [];
  // Unicode-aware split: keep Unicode LETTERS + NUMBERS (\p{L}\p{N}) + hyphen, instead of ASCII-only [a-z0-9].
  // The old class dropped/mangled non-ASCII terms ("autenticación" → "autenticaci" + "n"), so a non-English intent
  // lost its words in the lexical/trigram arms. The corpus is English, but the QUERY may not be — and this keeps
  // accented/CJK/Cyrillic terms intact so the lexical arm contributes for any model/language (semantic already does).
  for (const raw of normalize(s).split(/[^\p{L}\p{N}-]+/u)) {
    if (!raw) continue;
    const joined = raw.replace(/^-+|-+$/g, "");
    if (joined.length >= 2) out.push(joined);
    if (joined.includes("-")) {
      for (const part of joined.split("-")) {
        if (part.length >= 2) out.push(part);
      }
    }
  }
  return out;
}
