import type { Reranker } from '../types.js';

export function createPassthroughReranker(): Reranker {
  return {
    async rerank(_query, candidates) {
      return candidates;
    },
  };
}
