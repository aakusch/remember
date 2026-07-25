import { describe, expect, it } from 'vitest';
import { createHybridSearchEngine } from '../src/search/hybrid.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createPassthroughReranker } from '../src/rerankers/none.js';
import type { SearchResult, Store } from '../src/types.js';

function hit(id: string, score: number): SearchResult {
  return {
    // Paths deliberately carry no query terms so the path boost stays inert.
    path: `${id}.md`,
    chunk_idx: 0,
    snippet: '',
    frontmatter: {},
    score,
    retrievers: ['bm25'],
    chunk_id: `${id}.md#0`,
  };
}

/**
 * `solo` is rank 1 in BM25 only. `both` is rank 20 in BOTH retrievers.
 *
 * RRF scores them 0.5/(k+1) versus 2*0.5/(k+20), so which one wins depends
 * entirely on k: a small k rewards the single strong rank, a large k flattens
 * that advantage and lets the doubly-ranked-but-deep document win.
 */
function fixtureStore(): Store {
  const bm25 = [
    hit('solo', 10),
    ...Array.from({ length: 18 }, (_, i) => hit(`bfill${i}`, 9 - i * 0.1)),
    hit('both', 1),
  ];
  const vector = [
    ...Array.from({ length: 19 }, (_, i) => hit(`vfill${i}`, 9 - i * 0.1)),
    hit('both', 1),
  ];
  return {
    async searchBm25() {
      return bm25;
    },
    async searchVector() {
      return vector;
    },
    async getChunkTexts() {
      return new Map();
    },
  } as unknown as Store;
}

async function topPath(rrfK?: number): Promise<string> {
  const engine = createHybridSearchEngine(
    fixtureStore(),
    createHashEmbedder(384),
    createPassthroughReranker(),
    {
      ...(rrfK === undefined ? {} : { rrfK }),
      limits: { perRetrieverK: 20, candidateK: 20, finalK: 10 },
    },
  );
  const out = await engine.query({ query: 'unrelated terms' }, { k: 10 });
  return out.results[0]!.path;
}

describe('RRF rank constant default', () => {
  it('defaults to a value that preserves top-rank signal', async () => {
    // Regression guard for the default itself: 60 (the classic TREC constant)
    // is too flat for candidate sets of <=200 and measurably lost recall and
    // nDCG on every fixture.
    expect(await topPath()).toBe('solo.md');
    expect(await topPath(10)).toBe('solo.md');
  });

  it('shows why 60 was too flat at these candidate counts', async () => {
    expect(await topPath(60)).toBe('both.md');
  });
});
