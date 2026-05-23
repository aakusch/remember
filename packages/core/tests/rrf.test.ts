import { describe, it, expect } from 'vitest';
import { rrfFuse } from '../src/search/rrf.js';
import type { SearchResult } from '../src/types.js';

const r = (chunk_id: string, retriever: 'bm25' | 'vector'): SearchResult => ({
  path: `${chunk_id}.md`,
  chunk_idx: 0,
  snippet: '',
  frontmatter: {},
  score: 1,
  retrievers: [retriever],
  chunk_id,
});

describe('rrfFuse', () => {
  it('returns empty for empty inputs', () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([[]])).toEqual([]);
  });

  it('orders by reciprocal rank when only one list', () => {
    const fused = rrfFuse([[r('a', 'bm25'), r('b', 'bm25'), r('c', 'bm25')]]);
    expect(fused.map((x) => x.chunk_id)).toEqual(['a', 'b', 'c']);
  });

  it('boosts docs appearing in multiple lists', () => {
    // a appears in both at rank 0/0; b only in list 1 at rank 0; c only in list 2 at rank 0
    const fused = rrfFuse(
      [
        [r('a', 'bm25'), r('b', 'bm25')],
        [r('a', 'vector'), r('c', 'vector')],
      ],
      { finalK: 10 },
    );
    expect(fused[0]!.chunk_id).toBe('a');
    expect(new Set(fused[0]!.retrievers)).toEqual(new Set(['bm25', 'vector']));
  });

  it('respects finalK cap', () => {
    const long = Array.from({ length: 30 }, (_, i) => r(`x${i}`, 'bm25'));
    const fused = rrfFuse([long], { finalK: 5 });
    expect(fused).toHaveLength(5);
  });
});
