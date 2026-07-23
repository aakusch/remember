import type { Reranker } from '../types.js';

export function createPassthroughReranker(): Reranker {
  return {
    id: 'passthrough-v1',
    async rerank(_query, candidates) {
      return candidates;
    },
  };
}
