import { describe, expect, it } from 'vitest';
import { createHybridSearchEngine } from '../src/search/hybrid.js';
import { createPassthroughReranker } from '../src/rerankers/none.js';
import type {
  Embedder,
  Reranker,
  SearchResult,
  Store,
} from '../src/types.js';

describe('corrected retrieval pipeline', () => {
  it('lets a reranker promote a candidate below the old finalK cutoff', async () => {
    const hits = Array.from({ length: 6 }, (_, index) => hit(`page-${index}.md`, index));
    const reranker: Reranker = {
      id: 'promote-tail',
      async rerank(_query, candidates) {
        return [candidates[5]!, ...candidates.slice(0, 5)];
      },
    };
    const engine = createHybridSearchEngine(
      fakeStore({ bm25: hits }),
      fakeEmbedder(),
      reranker,
      {
        bm25: { enabled: true, weight: 1 },
        vector: { enabled: false },
        limits: { perRetrieverK: 6, candidateK: 6, finalK: 2 },
        pathBoostFactor: 0,
        headingBoostFactor: 0,
        dedupByPage: false,
      },
    );

    const response = await engine.query('query', { k: 2, trace: true });
    expect(response.results[0]!.chunk_id).toBe('page-5.md#5');
    expect(response.trace?.candidates.before_rerank_ids).toHaveLength(6);
  });

  it('backfills distinct pages after page diversity removes duplicate chunks', async () => {
    const engine = createHybridSearchEngine(
      fakeStore({
        bm25: [
          hit('a.md', 0),
          hit('a.md', 1),
          hit('a.md', 2),
          hit('b.md', 0),
          hit('c.md', 0),
        ],
      }),
      fakeEmbedder(),
      createPassthroughReranker(),
      {
        bm25: { enabled: true, weight: 1 },
        vector: { enabled: false },
        limits: { perRetrieverK: 5, candidateK: 5, finalK: 3 },
        pathBoostFactor: 0,
        headingBoostFactor: 0,
        dedupByPage: true,
      },
    );

    const response = await engine.query('query', { k: 3 });
    expect(response.results.map((result) => result.path)).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
  });

  it('starts BM25 while the embedding/vector branch is still pending', async () => {
    const bm25Started = deferred<void>();
    const embedStarted = deferred<void>();
    const releaseBm25 = deferred<void>();
    const releaseEmbed = deferred<void>();
    const store = fakeStore({
      async searchBm25() {
        bm25Started.resolve();
        await releaseBm25.promise;
        return [hit('lexical.md', 0, 'bm25')];
      },
      vector: [hit('semantic.md', 0, 'vector')],
    });
    const embedder: Embedder = {
      dim: 1,
      modelId: 'gated',
      async embed() {
        embedStarted.resolve();
        await releaseEmbed.promise;
        return [[1]];
      },
    };
    const engine = createHybridSearchEngine(
      store,
      embedder,
      createPassthroughReranker(),
      {
        limits: { perRetrieverK: 5, candidateK: 5, finalK: 2 },
      },
    );

    const pending = engine.query('query', { trace: true });
    try {
      await Promise.race([
        Promise.all([bm25Started.promise, embedStarted.promise]),
        rejectAfter(250, 'retrieval branches did not overlap'),
      ]);
    } finally {
      releaseBm25.resolve();
      releaseEmbed.resolve();
    }
    const response = await pending;
    expect(response.trace?.timings).toEqual(
      expect.objectContaining({
        bm25_ms: expect.any(Number),
        embed_ms: expect.any(Number),
        vector_ms: expect.any(Number),
        candidate_retrieval_ms: expect.any(Number),
      }),
    );
  });

  it('falls back to deterministic candidates when a reranker fails', async () => {
    const reranker: Reranker = {
      id: 'broken',
      async rerank() {
        throw new Error('provider included a secret that must not be traced');
      },
    };
    const engine = createHybridSearchEngine(
      fakeStore({ bm25: [hit('safe.md', 0)] }),
      fakeEmbedder(),
      reranker,
      {
        bm25: { enabled: true, weight: 1 },
        vector: { enabled: false },
      },
    );

    const response = await engine.query('safe', { trace: true });
    expect(response.results[0]!.path).toBe('safe.md');
    expect(response.trace?.fallback).toEqual({
      stage: 'reranker',
      reason: 'reranker_error:Error',
    });
    expect(JSON.stringify(response.trace)).not.toContain('secret');
  });
});

type FakeStoreOptions = {
  bm25?: SearchResult[];
  vector?: SearchResult[];
  searchBm25?: Store['searchBm25'];
};

function fakeStore(options: FakeStoreOptions): Store {
  return {
    async upsert() {},
    async deleteByPath() {
      return 0;
    },
    async searchVector() {
      return options.vector ?? [];
    },
    searchBm25:
      options.searchBm25 ??
      (async () => {
        return options.bm25 ?? [];
      }),
    async getManifest() {
      return {};
    },
    async updateManifest() {},
    async upsertPage() {},
    async deletePage() {},
    async queryPages() {
      return { rows: [], total: 0 };
    },
    async listFrontmatterKeys() {
      return [];
    },
  };
}

function fakeEmbedder(): Embedder {
  return {
    dim: 1,
    modelId: 'fake',
    async embed(texts) {
      return texts.map(() => [1]);
    },
  };
}

function hit(
  filePath: string,
  chunkIndex: number,
  retriever: 'bm25' | 'vector' = 'bm25',
): SearchResult {
  return {
    path: filePath,
    chunk_idx: chunkIndex,
    snippet: `query in ${filePath}`,
    frontmatter: {},
    score: 1,
    retrievers: [retriever],
    chunk_id: `${filePath}#${chunkIndex}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function rejectAfter(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), milliseconds);
  });
}
