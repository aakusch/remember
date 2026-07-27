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
            `LocalOnnxEmbedder requires the optional dependency "@huggingface/transformers". ` +
              `Install it in your project: npm install @huggingface/transformers. ` +
              `Underlying error: ${(err as Error).message}`,
          );
        }
        // The model (~100 MB) downloads on first use and is cached afterward.
        // Without a heads-up the first `remember dev` looks frozen for a minute.
        //
        // progress_callback fires per-file (config.json, tokenizer, model.onnx …)
        // MANY times per file. Two failure modes to avoid:
        //   1. keying "ready" off the per-file `done` event → prints N times.
        //   2. on a NON-TTY (piped to a file / CI log) `\r` doesn't overwrite,
        //      so a naive progress line spams hundreds of `tokenizer.json: 100%`
        //      rows. Verified bug from piping `remember dev` to a file.
        //
        // Fix: announce once. On a TTY, stream a single overwriting line via
        // `\r`. On a non-TTY, emit at most one newline update per file per 10%
        // step (and exactly one 100% line per file) — readable, never spammy.
        // Progress goes to stderr; gate TTY behaviour off stderr specifically.
        const isTty = Boolean(process.stderr.isTTY);
        let announcedDownload = false;
        const lastStep = new Map<string, number>(); // file → last printed 10% bucket
        const pipe = await transformers.pipeline('feature-extraction', modelId, {
          dtype: 'fp32',
          progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
            if (p.status === 'progress' && !announcedDownload) {
              announcedDownload = true;
              process.stderr.write(
                `[remember] downloading embedding model ${modelId} (first run only, ~100 MB)…\n`,
              );
            }
            if (p.status === 'progress' && typeof p.progress === 'number' && p.file) {
              const pct = Math.max(0, Math.min(100, Math.round(p.progress)));
              if (isTty) {
                // Single overwriting line — clears with a trailing pad.
                process.stderr.write(`\r[remember]   ${p.file}: ${pct}%   `);
              } else {
                // Throttle to one line per 10% bucket per file. `100 → bucket 10`
                // is printed once; a stuck 100% never repeats.
                const bucket = Math.floor(pct / 10);
                if (lastStep.get(p.file) !== bucket) {
                  lastStep.set(p.file, bucket);
                  process.stderr.write(`[remember]   ${p.file}: ${pct}%\n`);
                }
              }
            }
          },
        });
        if (announcedDownload) {
          // On a TTY, close out the overwriting line with a newline. On a
          // non-TTY the updates were already newline-terminated.
          if (isTty) process.stderr.write('\n');
          process.stderr.write(`[remember] embedding model ready.\n`);
        }
        return pipe;
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
