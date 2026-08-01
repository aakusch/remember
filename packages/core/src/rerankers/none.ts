import type { Reranker } from '../types.js';

export function createNoneReranker(): Reranker {
  return {
    id: 'none-v1',
    async rerank(_query, candidates) {
      return candidates;
    },
  };
}
