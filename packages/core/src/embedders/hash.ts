import { createHash } from 'node:crypto';
import type { Embedder } from '../types.js';

/**
 * Deterministic, dependency-free embedder used by tests and as a fallback
 * when the local-onnx embedder cannot load (e.g. no @huggingface/transformers).
 * Produces stable vectors derived from a SHA-256 hash of the input text.
 * Not semantically meaningful — same text → same vector, different text → different vector.
 */
export function createHashEmbedder(dim = 384): Embedder {
  return {
    dim,
    modelId: `hash-embedder-${dim}d`,
    async embed(texts) {
      return texts.map((t) => textToVector(t, dim));
    },
  };
}

function textToVector(text: string, dim: number): number[] {
  // Expand a single SHA-256 hash deterministically by re-hashing with index.
  const out: number[] = new Array<number>(dim);
  let i = 0;
  while (i < dim) {
    const h = createHash('sha256');
    h.update(`${i}|${text}`);
    const digest = h.digest();
    for (let j = 0; j < digest.length && i < dim; j += 2) {
      // Map two bytes → [-1, 1]
      const v = digest.readUInt16BE(j);
      out[i++] = (v / 0xffff) * 2 - 1;
    }
  }
  // Normalize to unit length so cosine distance ranges sensibly.
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < out.length; k++) out[k] = out[k]! / norm;
  return out;
}
