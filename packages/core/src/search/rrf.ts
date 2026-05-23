import type { SearchResult } from '../types.js';

/**
 * Reciprocal Rank Fusion. Combines ranked lists from multiple retrievers into
 * one fused ranking. Score for document d = sum over lists L of 1 / (k + rank_L(d)).
 *
 * - `k` is a constant smoothing factor (60 is the canonical default from Cormack et al.).
 * - Lower distance / better match should already be reflected in the lists' ordering.
 */
export function rrfFuse(
  lists: SearchResult[][],
  options: { k?: number; finalK?: number } = {},
): SearchResult[] {
  const k = options.k ?? 60;
  const finalK = options.finalK ?? 20;

  const accum = new Map<
    string,
    { result: SearchResult; score: number; retrievers: Set<'bm25' | 'vector'> }
  >();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const hit = list[rank]!;
      const id = hit.chunk_id;
      const contribution = 1 / (k + rank + 1);
      const existing = accum.get(id);
      if (existing) {
        existing.score += contribution;
        for (const r of hit.retrievers) existing.retrievers.add(r);
      } else {
        accum.set(id, {
          result: hit,
          score: contribution,
          retrievers: new Set(hit.retrievers),
        });
      }
    }
  }

  const fused = Array.from(accum.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, finalK)
    .map(({ result, score, retrievers }) => ({
      ...result,
      score,
      retrievers: Array.from(retrievers),
    }));

  return fused;
}
