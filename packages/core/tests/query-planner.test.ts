import { describe, expect, it } from 'vitest';
import { createHybridSearchEngine } from '../src/search/hybrid.js';
import {
  createPassthroughQueryPlanner,
  passthroughQueryPlan,
} from '../src/query-planners/passthrough.js';
import type {
  Embedder,
  QueryInput,
  QueryPlanner,
  Reranker,
  SearchResult,
  Store,
} from '../src/types.js';

describe('query planner seam', () => {
  it('returns only the original query without network-capable dependencies', async () => {
    const input: QueryInput = {
      query: 'rollback',
      intent: 'production recovery',
    };
    expect(passthroughQueryPlan(input)).toEqual({
      original: 'rollback',
      lexical: [{ id: 'original', text: 'rollback', weight: 1 }],
      semantic: [{ id: 'original', text: 'rollback', weight: 1 }],
    });
    await expect(createPassthroughQueryPlanner().plan(input)).resolves.toEqual(
      passthroughQueryPlan(input),
    );
  });

  it('carries intent to planner and reranker without searching the intent text', async () => {
    const planned: QueryInput[] = [];
    const bm25Queries: string[] = [];
    const embeddedTexts: string[][] = [];
    const rerankContexts: unknown[] = [];
    const planner: QueryPlanner = {
      id: 'recording',
      async plan(input) {
        planned.push(input);
        return passthroughQueryPlan(input);
      },
    };
    const reranker: Reranker = {
      id: 'recording',
      async rerank(_query, candidates, context) {
        rerankContexts.push(context);
        return candidates;
      },
    };
    const engine = createHybridSearchEngine(
      storeWithQueryRecording(bm25Queries),
      embedderWithRecording(embeddedTexts),
      reranker,
      {},
      planner,
    );

    await engine.query(
      { query: 'rollback', intent: 'production recovery procedure' },
      { trace: true },
    );

    expect(planned).toEqual([
      { query: 'rollback', intent: 'production recovery procedure' },
    ]);
    expect(bm25Queries).toEqual(['rollback']);
    expect(embeddedTexts).toEqual([['rollback']]);
    expect(rerankContexts).toEqual([
      { intent: 'production recovery procedure', mode: 'fast' },
    ]);
  });

  it('falls back to the original query when the optional planner fails', async () => {
    const bm25Queries: string[] = [];
    const planner: QueryPlanner = {
      id: 'broken-planner',
      async plan() {
        throw new Error('private provider response');
      },
    };
    const engine = createHybridSearchEngine(
      storeWithQueryRecording(bm25Queries),
      embedderWithRecording([]),
      {
        async rerank(_query, candidates) {
          return candidates;
        },
      },
      {},
      planner,
    );

    const response = await engine.query('rollback', { trace: true });
    expect(bm25Queries).toEqual(['rollback']);
    expect(response.results).toHaveLength(1);
    expect(response.trace?.planner).toEqual({
      id: 'broken-planner',
      lexical_variation_ids: ['original'],
      semantic_variation_ids: ['original'],
    });
    expect(response.trace?.fallback).toEqual({
      stage: 'planner',
      reason: 'planner_error:Error',
    });
    expect(JSON.stringify(response.trace)).not.toContain('private provider');
  });

  it('caps expansion contribution at the combined original-query weight', async () => {
    const planner: QueryPlanner = {
      id: 'overweight-expansion',
      async plan(input) {
        return {
          original: input.query,
          lexical: [
            { id: 'original', text: input.query, weight: 1 },
            { id: 'expanded', text: 'production recovery', weight: 100 },
          ],
          semantic: [
            { id: 'original', text: input.query, weight: 1 },
            { id: 'expanded', text: 'production recovery', weight: 100 },
          ],
        };
      },
    };
    const engine = createHybridSearchEngine(
      storeWithQueryRecording([]),
      embedderWithRecording([]),
      {
        async rerank(_query, candidates) {
          return candidates;
        },
      },
      {},
      planner,
    );

    const response = await engine.query('rollback', { trace: true });
    const contributions = response.trace!.ranking[0]!.contributions;
    const originalWeight = contributions
      .filter((item) => item.query_id === 'original')
      .reduce((sum, item) => sum + item.weight, 0);
    const expansionWeight = contributions
      .filter((item) => item.query_id === 'expanded')
      .reduce((sum, item) => sum + item.weight, 0);
    expect(expansionWeight).toBeLessThanOrEqual(originalWeight);
  });
});

function storeWithQueryRecording(queries: string[]): Store {
  const result = hit('rollback.md');
  return {
    async upsert() {},
    async deleteByPath() {
      return 0;
    },
    async searchVector() {
      return [result];
    },
    async searchBm25(query) {
      queries.push(query);
      return [result];
    },
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

function embedderWithRecording(recorded: string[][]): Embedder {
  return {
    dim: 1,
    modelId: 'recording',
    async embed(texts) {
      recorded.push(texts);
      return texts.map(() => [1]);
    },
  };
}

function hit(filePath: string): SearchResult {
  return {
    path: filePath,
    chunk_idx: 0,
    snippet: 'rollback production',
    frontmatter: {},
    score: 1,
    retrievers: ['bm25'],
    chunk_id: `${filePath}#0`,
  };
}
