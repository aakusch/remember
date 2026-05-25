import { describe, it, expect } from 'vitest';
import { applyPathBoost } from '../src/search/hybrid.js';
import type { SearchResult } from '../src/types.js';

function hit(path: string, score: number): SearchResult {
  return {
    path,
    chunk_idx: 0,
    snippet: '',
    frontmatter: {},
    score,
    retrievers: ['bm25'],
    chunk_id: `${path}#0`,
  };
}

describe('applyPathBoost', () => {
  it('returns hits unchanged when factor is 0', () => {
    const hits = [hit('foo.md', 0.5), hit('bar.md', 0.3)];
    expect(applyPathBoost(hits, 'foo', 0)).toEqual(hits);
  });

  it('returns hits unchanged when query has no content tokens', () => {
    const hits = [hit('foo.md', 0.5)];
    expect(applyPathBoost(hits, 'the and is', 2)).toEqual(hits);
  });

  it('boosts a page whose path contains all query terms', () => {
    const dedicated = hit('people/alexander-the-great.md', 0.016);
    const tangential = hit('ancient/egypt.md', 0.031);
    const out = applyPathBoost([tangential, dedicated], 'alexander the great', 2);
    expect(out[0]!.path).toBe('people/alexander-the-great.md');
  });

  it('scales boost by fraction of terms matched', () => {
    const all = hit('vietnam-war.md', 0.1);
    const half = hit('cold-war.md', 0.1);
    const out = applyPathBoost([half, all], 'vietnam war', 2);
    // "vietnam-war" has both tokens → 1 + (2/2)*2 = 3x score → 0.3
    // "cold-war"    has one token   → 1 + (1/2)*2 = 2x score → 0.2
    expect(out[0]!.path).toBe('vietnam-war.md');
    expect(out[0]!.score).toBeCloseTo(0.3, 3);
    expect(out[1]!.score).toBeCloseTo(0.2, 3);
  });

  it('strips file extension before matching', () => {
    const out = applyPathBoost([hit('napoleon.md', 0.01)], 'napoleon', 2);
    expect(out[0]!.score).toBeCloseTo(0.03, 3);
  });

  it('handles directory segments as candidate tokens', () => {
    const out = applyPathBoost([hit('twentieth-c/vietnam-war.md', 0.01)], 'vietnam war', 2);
    expect(out[0]!.score).toBeGreaterThan(0.02);
  });

  it('does nothing when no query term appears in any path', () => {
    const hits = [hit('foo/bar.md', 0.5), hit('baz/qux.md', 0.3)];
    const out = applyPathBoost(hits, 'unrelated', 2);
    expect(out).toEqual(hits);
  });
});
