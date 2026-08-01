import type { Embedder, RememberConfig } from '../types.js';
import { createLocalOnnxEmbedder } from '../embedders/local-onnx.js';
import { createOpenAIEmbedder } from '../embedders/openai.js';
import { createHashEmbedder } from '../embedders/hash.js';

/**
 * Resolves an Embedder from config + environment.
 *
 * Priority:
 *   1. OPENAI_API_KEY env var present → OpenAI. An explicit key is a deliberate
 *      opt-in and overrides the scaffold's DEFAULT local-onnx pin — this is exactly
 *      what the docs and the placeholder-embedder warning promise. (Previously the
 *      key was ignored whenever the config named local-onnx, which every
 *      `remember init` project does, so the advice printed on the worst onboarding
 *      failure could never work.)
 *   2. Configured local-onnx descriptor (or default) → @huggingface/transformers
 *   3. Fallback: hash embedder (deterministic, not semantically meaningful) — only if
 *      transformers.js is unavailable. Emits a warning.
 */
export async function resolveEmbedder(raw: RememberConfig): Promise<Embedder> {
  const descriptor = raw.pipeline?.embedder as { _kind?: string; opts?: Record<string, unknown> } | undefined;

  // Explicit override for tests / CI / offline runs. `hash` forces the deterministic
  // placeholder embedder (no model download, not semantically meaningful).
  if (process.env.REMEMBER_EMBEDDER === 'hash') {
    return createHashEmbedder(384);
  }

  if (process.env.OPENAI_API_KEY) {
    // Only carry the configured model when it's actually an OpenAI model; a
    // local-onnx model name (e.g. bge-small) is meaningless to OpenAI.
    const model =
      descriptor?._kind === 'embedder:openai' ? (descriptor?.opts?.model as string | undefined) : undefined;
    return createOpenAIEmbedder({ model });
  }

  // Check optional dependency presence without forcing a model download.
  try {
    await import('@huggingface/transformers');
  } catch {
    // Loud on purpose: on the hash embedder, search RUNS but returns
    // semantically meaningless results. A quiet fallback reads as "bad search
    // quality" instead of "missing a dependency" — the worst onboarding trap.
    process.stderr.write(
      `\n` +
        `  ⚠  remember is using the PLACEHOLDER embedder — search will return\n` +
        `     meaningless results. Real semantic search needs one of:\n` +
        `       • npm install @huggingface/transformers   (free, local, recommended)\n` +
        `       • set OPENAI_API_KEY in your environment    (uses OpenAI embeddings)\n` +
        `     Then restart. See https://github.com/aakusch/remember#embeddings\n\n`,
    );
    return createHashEmbedder(384);
  }

  const model = (descriptor?.opts?.model as string | undefined) ?? undefined;
  return createLocalOnnxEmbedder({ model });
}
