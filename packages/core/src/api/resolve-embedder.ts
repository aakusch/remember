import type { Embedder, RememberConfig } from '../types.js';
import { createLocalOnnxEmbedder } from '../embedders/local-onnx.js';
import { createOpenAIEmbedder } from '../embedders/openai.js';
import { createHashEmbedder } from '../embedders/hash.js';

/**
 * Resolves an Embedder from config + environment.
 *
 * Priority:
 *   1. OPENAI_API_KEY env var present + embedder config not pinned to local-onnx → OpenAI
 *   2. Configured local-onnx descriptor (or default) → @huggingface/transformers
 *   3. Fallback: hash embedder (deterministic, not semantically meaningful) — only if
 *      transformers.js is unavailable. Emits a warning.
 */
export async function resolveEmbedder(raw: RememberConfig): Promise<Embedder> {
  const descriptor = raw.pipeline?.embedder as { _kind?: string; opts?: Record<string, unknown> } | undefined;

  const wantsOpenAI = descriptor?._kind === 'embedder:openai' || (process.env.OPENAI_API_KEY && descriptor?._kind !== 'embedder:localOnnx');

  if (wantsOpenAI && process.env.OPENAI_API_KEY) {
    const model = (descriptor?.opts?.model as string | undefined) ?? undefined;
    return createOpenAIEmbedder({ model });
  }

  // Check optional dependency presence without forcing a model download.
  try {
    await import('@huggingface/transformers');
  } catch (err) {
    process.stderr.write(
      `[remember] @huggingface/transformers not installed; falling back to hash embedder ` +
        `(deterministic but not semantically meaningful). Install it for real local embeddings:\n` +
        `  pnpm --filter @useremember/core add @huggingface/transformers\n` +
        `Underlying: ${(err as Error).message}\n`,
    );
    return createHashEmbedder(384);
  }

  const model = (descriptor?.opts?.model as string | undefined) ?? undefined;
  return createLocalOnnxEmbedder({ model });
}
