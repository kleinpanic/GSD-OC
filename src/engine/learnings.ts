/**
 * OCT-W4 — the learnings store (native port of learnings.cjs). A cross-project knowledge base of decisions,
 * lessons, and patterns, so insight from one project informs the next. Stored as JSONL under a global root
 * (default `$HOME/.gsd-oc/learnings.jsonl`), append-only with query/prune. Lives outside any one `.planning/`
 * because its value is cross-project (upstream's model).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Learning {
  ts: string;
  kind: "decision" | "lesson" | "pattern";
  text: string;
  tags: string[];
  project?: string;
}

function learningsPath(root: string = path.join(os.homedir(), ".gsd-oc")): string {
  return path.join(root, "learnings.jsonl");
}

/** Append a learning (append-only — never rewrites prior entries). `now` injected for deterministic tests. */
export function addLearning(
  entry: { kind: Learning["kind"]; text: string; tags?: string[]; project?: string },
  opts: { root?: string; now?: string } = {},
): Learning {
  if (!entry.text?.trim()) throw new Error("addLearning: text required");
  const kind = (["decision", "lesson", "pattern"] as const).includes(entry.kind) ? entry.kind : "lesson";
  const rec: Learning = {
    ts: opts.now ?? new Date().toISOString(),
    kind,
    text: entry.text.trim(),
    tags: (entry.tags ?? []).map((t) => t.toLowerCase()),
    project: entry.project,
  };
  const file = learningsPath(opts.root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + "\n");
  return rec;
}

/** Read all learnings (skips malformed lines defensively). */
export function listLearnings(opts: { root?: string } = {}): Learning[] {
  let raw: string;
  try {
    raw = fs.readFileSync(learningsPath(opts.root), "utf8");
  } catch {
    return [];
  }
  const out: Learning[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Learning);
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}

/** Query by free-text (matches text/tags) and/or kind. Most-recent first, capped at `limit`. */
export function queryLearnings(
  q: { text?: string; kind?: Learning["kind"]; tag?: string; limit?: number } = {},
  opts: { root?: string } = {},
): Learning[] {
  const needle = (q.text ?? "").toLowerCase();
  const tag = q.tag?.toLowerCase();
  const hits = listLearnings(opts).filter((l) => {
    if (q.kind && l.kind !== q.kind) return false;
    if (tag && !l.tags.includes(tag)) return false;
    if (needle && !(l.text.toLowerCase().includes(needle) || l.tags.some((t) => t.includes(needle)))) return false;
    return true;
  });
  hits.reverse(); // newest first
  return hits.slice(0, Math.max(1, Math.min(q.limit ?? 20, 200)));
}

/** Prune: keep the most-recent `keep` entries (bounds the global store). Returns the removed count. */
export function pruneLearnings(keep: number, opts: { root?: string } = {}): number {
  const all = listLearnings(opts);
  if (all.length <= keep) return 0;
  const kept = all.slice(all.length - keep);
  fs.writeFileSync(learningsPath(opts.root), kept.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return all.length - kept.length;
}
