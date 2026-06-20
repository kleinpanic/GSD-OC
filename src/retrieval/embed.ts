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

// The corpus vectors were embedded with this model at 2048-dim — the query MUST use the same model,
// so it is the default when SPARK_EMBEDDINGS_MODEL is unset. Default port mirrors the spark NIM.
const DEFAULT_MODEL = "nvidia/llama-nemotron-embed-vl-1b-v2";
const DEFAULT_PORT = "18091";

/**
 * Resolve the spark token from any of the env names the host environment may provide. The OpenClaw
 * gateway exports SPARK_BEARER_TOKEN / SPARK_API_KEY; build/dev shells may use SPARK_BEARER_AUTH.
 */
function sparkToken(env: NodeJS.ProcessEnv): string | undefined {
  return env.SPARK_BEARER_TOKEN || env.SPARK_BEARER_AUTH || env.SPARK_API_KEY;
}

/**
 * Resolve the spark base URL. Prefer an explicit SPARK_EMBEDDINGS_BASE_URL; otherwise derive it from
 * SPARK_HOST (what the gateway actually exports — e.g. "10.0.0.1") + the default NIM port + /v1.
 */
function sparkBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.SPARK_EMBEDDINGS_BASE_URL) return env.SPARK_EMBEDDINGS_BASE_URL.replace(/\/+$/, "");
  const host = env.SPARK_HOST;
  if (!host) return undefined;
  // SPARK_HOST with a scheme: keep as-is but ensure an OpenAI-style version path (…/v1) so the
  // embeddings POST hits {base}/embeddings, not the bare root (review HIGH-2).
  if (/^https?:\/\//.test(host)) {
    const u = host.replace(/\/+$/, "");
    return /\/v\d+$/.test(u) ? u : `${u}/v1`;
  }
  const port = env.SPARK_PORT || DEFAULT_PORT;
  return `http://${host}:${port}/v1`;
}

export function embedAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(sparkBaseUrl(env) && sparkToken(env));
}

export function sparkConfig(env: NodeJS.ProcessEnv = process.env): SparkConfig {
  const baseUrl = sparkBaseUrl(env);
  const token = sparkToken(env);
  const model = env.SPARK_EMBEDDINGS_MODEL || DEFAULT_MODEL;
  if (!baseUrl || !token) {
    throw new Error(
      "spark not configured: set SPARK_EMBEDDINGS_BASE_URL (or SPARK_HOST) and SPARK_BEARER_TOKEN (or SPARK_API_KEY)",
    );
  }
  return { baseUrl, model, token };
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
