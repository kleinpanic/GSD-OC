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
  for (const raw of normalize(s).split(/[^a-z0-9-]+/)) {
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
