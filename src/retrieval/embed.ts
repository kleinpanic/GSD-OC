/**
 * RET-02 embedder: the "spark" NIM client (nvidia/llama-nemotron-embed-vl-1b-v2, 2048-dim).
 * OpenAI-compatible POST {base}/embeddings with asymmetric input_type (query|passage). The bearer
 * token is read from the environment and NEVER inlined or logged. Used at BUILD time (corpus, as
 * "passage") and at RUNTIME (the query, as "query"). DoD item 2 was amended to permit this secret.
 */
export interface SparkConfig {
  baseUrl: string;
  model: string;
  token: string;
}

export type InputType = "query" | "passage";

const MAX_BATCH = 64;
const TIMEOUT_MS = 30000;

export function embedAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.SPARK_EMBEDDINGS_BASE_URL && env.SPARK_EMBEDDINGS_MODEL && (env.SPARK_BEARER_TOKEN || env.SPARK_BEARER_AUTH),
  );
}

export function sparkConfig(env: NodeJS.ProcessEnv = process.env): SparkConfig {
  const baseUrl = env.SPARK_EMBEDDINGS_BASE_URL;
  const model = env.SPARK_EMBEDDINGS_MODEL;
  const token = env.SPARK_BEARER_TOKEN || env.SPARK_BEARER_AUTH;
  if (!baseUrl || !model || !token) {
    throw new Error(
      "spark not configured: set SPARK_EMBEDDINGS_BASE_URL, SPARK_EMBEDDINGS_MODEL, and SPARK_BEARER_TOKEN",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), model, token };
}

export interface EmbedOptions {
  env?: NodeJS.ProcessEnv;
  config?: SparkConfig;
  fetch?: typeof fetch;
}

async function embedBatch(cfg: SparkConfig, texts: string[], inputType: InputType, fetchImpl: typeof fetch): Promise<number[][]> {
  const body = JSON.stringify({ model: cfg.model, input: texts, input_type: inputType });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${cfg.baseUrl}/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`spark embeddings HTTP ${res.status}`);
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      if (json.data.length !== texts.length) throw new Error(`spark returned ${json.data.length} embeddings for ${texts.length} inputs`);
      return json.data.slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`spark embeddings failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** Embed texts in input order, batched (≤64/request). Returns one 2048-dim vector per input. */
export async function embedTexts(texts: string[], inputType: InputType, opts: EmbedOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const cfg = opts.config ?? sparkConfig(opts.env);
  const fetchImpl = opts.fetch ?? fetch;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    out.push(...(await embedBatch(cfg, texts.slice(i, i + MAX_BATCH), inputType, fetchImpl)));
  }
  return out;
}
