import type { Embedder } from '../types.js';

export interface LocalOnnxEmbedderOptions {
  model?: string;
  dim?: number;
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
  const modelId = opts.model ?? 'BAAI/bge-small-en-v1.5';
  const dim = opts.dim ?? MODEL_DIMS[modelId] ?? 384;

  let pipelinePromise: Promise<unknown> | null = null;

  async function getPipeline() {
    if (!pipelinePromise) {
      pipelinePromise = (async () => {
        let transformers: typeof import('@huggingface/transformers');
        try {
          transformers = await import('@huggingface/transformers');
        } catch (err) {
          throw new Error(
            `LocalOnnxEmbedder requires the optional dependency "@huggingface/transformers". Install it with: pnpm add @huggingface/transformers (filter @remember/core). Underlying error: ${(err as Error).message}`,
          );
        }
        return transformers.pipeline('feature-extraction', modelId, {
          dtype: 'fp32',
        });
      })();
    }
    return pipelinePromise;
  }

  return {
    dim,
    modelId,
    async embed(texts) {
      if (texts.length === 0) return [];
      const pipe = (await getPipeline()) as (
        input: string | string[],
        opts: { pooling: 'mean' | 'cls'; normalize: boolean },
      ) => Promise<{ data: Float32Array; dims: number[] }>;

      const out = await pipe(texts, { pooling: 'mean', normalize: true });
      const batch = out.dims[0] ?? texts.length;
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
