import type { Embedder } from '../types.js';

export interface OpenAIEmbedderOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  /**
   * Max items per API call. OpenAI's hard limit is 2048; we default to 100
   * to keep per-request latency reasonable and to amortize retries on a
   * smaller batch when a 429 hits. Override if you have a use case (large
   * static-corpus reindex) where bigger batches help.
   */
  batchSize?: number;
  /** Max retry attempts on transient failures (429, 500, network). */
  maxRetries?: number;
}

const MODEL_DIMS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

export function createOpenAIEmbedder(opts: OpenAIEmbedderOptions = {}): Embedder {
  const modelId = opts.model ?? 'text-embedding-3-small';
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const baseURL = opts.baseURL ?? 'https://api.openai.com/v1';
  const dim = MODEL_DIMS[modelId] ?? 1536;
  const batchSize = opts.batchSize ?? 100;
  const maxRetries = opts.maxRetries ?? 5;

  if (!apiKey) {
    throw new Error('OpenAI embedder requires OPENAI_API_KEY env var or opts.apiKey');
  }

  return {
    dim,
    modelId,
    async embed(texts) {
      if (texts.length === 0) return [];

      // Batch: OpenAI accepts up to ~2048 inputs per call, but smaller
      // batches mean smaller blast radius when a retry is needed.
      const out: number[][] = new Array(texts.length);
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        const embeddings = await embedBatchWithRetry({
          batch,
          modelId,
          apiKey,
          baseURL,
          maxRetries,
        });
        for (let i = 0; i < embeddings.length; i++) {
          out[start + i] = embeddings[i]!;
        }
      }
      return out;
    },
  };
}

/**
 * Single-batch embed with exponential backoff + jitter on transient errors.
 *
 * Retries: 429 (rate limit), 500/502/503/504 (transient server issues),
 * and network errors (fetch throws). Honors the Retry-After header when
 * present (OpenAI sends it on 429). Otherwise: 250ms * 2^attempt with
 * full jitter, capped at 30s.
 *
 * Hard fails on: 400 (bad request — won't get better by retrying), 401
 * (auth), 403 (perm). Those throw immediately so the caller sees the real
 * error instead of "max retries exhausted".
 */
async function embedBatchWithRetry(opts: {
  batch: string[];
  modelId: string;
  apiKey: string;
  baseURL: string;
  maxRetries: number;
}): Promise<number[][]> {
  const { batch, modelId, apiKey, baseURL, maxRetries } = opts;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: modelId, input: batch }),
      });

      if (res.ok) {
        const json = (await res.json()) as {
          data: Array<{ embedding: number[]; index: number }>;
        };
        const sorted = [...json.data].sort((a, b) => a.index - b.index);
        return sorted.map((d) => d.embedding);
      }

      // Permanent errors — don't retry.
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const body = await res.text();
        throw new Error(`OpenAI embeddings failed (${res.status}): ${body}`);
      }

      // Transient — fall through to backoff.
      const body = await res.text();
      lastErr = new Error(`OpenAI embeddings ${res.status}: ${body}`);

      if (attempt === maxRetries) break;

      const retryAfterHeader = res.headers.get('retry-after');
      const baseDelayMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : Math.min(30_000, 250 * 2 ** attempt);
      const jitterMs = Math.random() * baseDelayMs * 0.5;
      await sleep(baseDelayMs + jitterMs);
    } catch (err) {
      // Network error or thrown above. Permanent? Stop. Transient? Backoff.
      lastErr = err instanceof Error ? err : new Error(String(err));
      const msg = lastErr.message;
      if (/\b(400|401|403)\b/.test(msg)) throw lastErr;
      if (attempt === maxRetries) break;
      const baseDelayMs = Math.min(30_000, 250 * 2 ** attempt);
      const jitterMs = Math.random() * baseDelayMs * 0.5;
      await sleep(baseDelayMs + jitterMs);
    }
  }

  throw lastErr ?? new Error('OpenAI embeddings: max retries exhausted');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
