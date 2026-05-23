import type { Embedder } from '../types.js';

export interface OpenAIEmbedderOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
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

  if (!apiKey) {
    throw new Error('OpenAI embedder requires OPENAI_API_KEY env var or opts.apiKey');
  }

  return {
    dim,
    modelId,
    async embed(texts) {
      if (texts.length === 0) return [];
      const res = await fetch(`${baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: modelId, input: texts }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI embeddings failed (${res.status}): ${body}`);
      }

      const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    },
  };
}
