/**
 * Deterministic markdown chunker (RET-01). Splits a doc at markdown headings
 * (`#`–`###`), then packs each section's paragraphs into chunks of at most
 * `maxChars`, never splitting a paragraph. Determinism matters: the same input
 * must yield byte-identical chunks so the merkle manifest (RET-06) is stable and
 * embeddings (RET-02) are only recomputed on real change.
 */
import type { GsdDoc, GsdChunk } from "./types.js";

const HEADING = /^(#{1,3})\s+(.*\S)\s*$/;

interface Section {
  heading: string;
  body: string;
}

/** Split raw markdown into heading-bounded sections, preserving order. */
function sections(text: string, fallbackHeading: string): Section[] {
  const out: Section[] = [];
  let heading = fallbackHeading;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body.length > 0) out.push({ heading, body });
    buf = [];
  };
  let inFence = false;
  for (const line of text.split("\n")) {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) inFence = !inFence;
    const m = inFence || fence ? null : HEADING.exec(line);
    if (m) {
      flush();
      heading = m[2];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Hard-split an oversized string on a whitespace boundary into <= maxChars pieces. */
function hardSplit(s: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = s;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut <= 0) cut = maxChars; // no whitespace boundary — slice hard
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

/** Pack paragraphs (blank-line separated) into <= maxChars pieces without splitting one. */
function packParagraphs(body: string, maxChars: number): string[] {
  const raw = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  // A single paragraph longer than maxChars can never fit; hard-split it first.
  const paras = raw.flatMap((p) => (p.length > maxChars ? hardSplit(p, maxChars) : [p]));
  const pieces: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur === "") {
      cur = p;
    } else if (cur.length + 2 + p.length <= maxChars) {
      cur = `${cur}\n\n${p}`;
    } else {
      pieces.push(cur);
      cur = p;
    }
  }
  if (cur !== "") pieces.push(cur);
  return pieces;
}

/**
 * Chunk one doc into ordered retrieval units. A section larger than `maxChars` is
 * packed into multiple chunks; the chunk `heading` always names its source section.
 */
export function chunkDoc(doc: GsdDoc, maxChars = 1200): GsdChunk[] {
  const chunks: GsdChunk[] = [];
  let ordinal = 0;
  for (const sec of sections(doc.text, doc.title)) {
    for (const piece of packParagraphs(sec.body, maxChars)) {
      chunks.push({
        id: `${doc.id}#${ordinal}`,
        docId: doc.id,
        kind: doc.kind,
        title: doc.title,
        heading: sec.heading,
        ordinal,
        text: piece,
      });
      ordinal++;
    }
  }
  // A doc whose body is only a heading (no paragraphs) still gets one title chunk.
  if (chunks.length === 0 && doc.text.trim().length > 0) {
    chunks.push({
      id: `${doc.id}#0`,
      docId: doc.id,
      kind: doc.kind,
      title: doc.title,
      heading: doc.title,
      ordinal: 0,
      text: doc.text.trim().slice(0, maxChars),
    });
  }
  return chunks;
}
