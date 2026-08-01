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

// Max sequence length each model embeds before truncating (tokens). These small
// sentence-transformers all cap at 512.
const MODEL_MAX_TOKENS: Record<string, number> = {
  'BAAI/bge-small-en-v1.5': 512,
  'sentence-transformers/all-MiniLM-L6-v2': 256,
  'mixedbread-ai/mxbai-embed-xsmall-v1': 512,
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
        // MANY times per file. Failure modes to avoid:
        //   1. keying "ready" off the per-file `done` event → prints N times.
        //   2. on a NON-TTY (piped to a file / CI log) `\r` doesn't overwrite,
        //      so a naive progress line spams hundreds of `tokenizer.json: 100%`
        //      rows. Verified bug from piping `remember dev` to a file.
        //   3. transformers.js v3 fires `status: 'progress'` events even when
        //      reading a fully-cached model off disk (a ~0.3s no-op). Announcing
        //      on the first progress event therefore printed a scary
        //      "downloading ~100 MB (first run only)…" banner on EVERY search /
        //      status / list, even offline. Verified: a warm-cache search runs in
        //      ~0.3s yet still emitted the banner + per-file progress spam.
        //
        // Fix: DEFER the announcement. Only a genuine network download takes
        // real time, so we arm a timer and announce (once) only if loading is
        // still in flight after a short beat. A cache read resolves first, the
        // timer is cleared, and nothing is printed. On a real download the banner
        // appears after the beat and progress streams from there. On a TTY,
        // stream a single overwriting `\r` line; on a non-TTY, at most one line
        // per file per 10% bucket. All progress goes to stderr.
        const isTty = Boolean(process.stderr.isTTY);
        const ANNOUNCE_AFTER_MS = 1500;
        let announcedDownload = false;
        const lastStep = new Map<string, number>(); // file → last printed 10% bucket
        let announceTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          announcedDownload = true;
          process.stderr.write(
            `[remember] downloading embedding model ${modelId} (first run only, ~100 MB)…\n`,
          );
        }, ANNOUNCE_AFTER_MS);
        if (typeof announceTimer.unref === 'function') announceTimer.unref();
        let pipe: Awaited<ReturnType<typeof transformers.pipeline>>;
        try {
          pipe = await transformers.pipeline('feature-extraction', modelId, {
            dtype: 'fp32',
            progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
              // Stay silent until the deferred timer has decided this is a real
              // download — a warm-cache read never reaches that point.
              if (!announcedDownload) return;
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
        } catch (error) {
          throw new Error(
            `Failed to load embedding model "${modelId}". It downloads once (~100 MB) and ` +
              `needs network access to huggingface.co on first use. Check connectivity and retry; ` +
              `no server restart is needed. Underlying error: ${(error as Error).message}`,
          );
        }
        if (announceTimer) {
          clearTimeout(announceTimer);
          announceTimer = null;
        }
        if (announcedDownload) {
          // On a TTY, close out the overwriting line with a newline. On a
          // non-TTY the updates were already newline-terminated.
          if (isTty) process.stderr.write('\n');
          process.stderr.write(`[remember] embedding model ready.\n`);
        }
        return pipe;
      })().catch((error) => {
        // A transient model-download failure must not poison all later search or
        // index requests for the lifetime of this process.
        pipelinePromise = null;
        throw error;
      });
    }
    return pipelinePromise;
  }

  return {
    dim,
    modelId,
    maxInputTokens: MODEL_MAX_TOKENS[modelId] ?? 512,
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
