import type { Embedder } from '../types.js';

export interface LocalOnnxEmbedderOptions {
  model?: string;
  dim?: number;
  /**
   * Pooling strategy. BAAI/bge-* models are trained with CLS pooling, so mean
   * pooling silently mismatches the model and degrades every vector. Defaults
   * to 'mean' for backwards compatibility with existing indexes; changing it
   * invalidates any index built with the other setting.
   */
  pooling?: 'mean' | 'cls';
  /**
   * Prepended to QUERY text only (never documents). BGE retrieval models are
   * trained with an instruction on the query side.
   */
  queryPrefix?: string;
}

const MODEL_DIMS: Record<string, number> = {
  'BAAI/bge-small-en-v1.5': 384,
  'sentence-transformers/all-MiniLM-L6-v2': 384,
  'mixedbread-ai/mxbai-embed-xsmall-v1': 384,
};

/**
 * Local embedder using @huggingface/transformers (transformers.js v3) under the hood.
 * Loads the ONNX model lazily on first `embed()` call. Falls back gracefully if the
 * optional dependency isn't installed — in that case the caller should swap to a
 * different embedder.
 */
export function createLocalOnnxEmbedder(opts: LocalOnnxEmbedderOptions = {}): Embedder {
  const model = opts.model ?? 'BAAI/bge-small-en-v1.5';
  const pooling = opts.pooling ?? 'mean';
  const queryPrefix = opts.queryPrefix ?? '';
  const dim = opts.dim ?? MODEL_DIMS[model] ?? 384;
  // modelId must encode anything that changes the vectors, because it keys the
  // benchmark index cache and labels result artifacts. Without this, switching
  // pooling would silently reuse a mismatched index.
  const modelId =
    pooling === 'mean' && !queryPrefix
      ? model
      : `${model}#${pooling}${queryPrefix ? '+qprefix' : ''}`;

  let pipelinePromise: Promise<unknown> | null = null;

  async function getPipeline() {
    if (!pipelinePromise) {
      pipelinePromise = (async () => {
        let transformers: typeof import('@huggingface/transformers');
        try {
          transformers = await import('@huggingface/transformers');
        } catch (err) {
          throw new Error(
            `LocalOnnxEmbedder requires the optional dependency "@huggingface/transformers". Install it with: pnpm add @huggingface/transformers (filter @useremember/core). Underlying error: ${(err as Error).message}`,
          );
        }
        return transformers.pipeline('feature-extraction', model, {
          dtype: 'fp32',
        });
      })();
    }
    return pipelinePromise;
  }

  return {
    dim,
    modelId,
    async embed(texts, role) {
      if (texts.length === 0) return [];
      const prepared =
        queryPrefix && role === 'query' ? texts.map((t) => `${queryPrefix}${t}`) : texts;
      const pipe = (await getPipeline()) as (
        input: string | string[],
        opts: { pooling: 'mean' | 'cls'; normalize: boolean },
      ) => Promise<{ data: Float32Array; dims: number[] }>;

      const out = await pipe(prepared, { pooling, normalize: true });
      const batch = out.dims[0] ?? prepared.length;
      const vecDim = out.dims[1] ?? dim;
      const result: number[][] = new Array(batch);
      for (let i = 0; i < batch; i++) {
        const slice = out.data.subarray(i * vecDim, (i + 1) * vecDim);
        result[i] = Array.from(slice);
      }
      return result;
    },
  };
}
