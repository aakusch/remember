import type { Embedder, Reranker, SearchEngine, Store } from '../types.js';
import { rrfFuse } from './rrf.js';

export interface HybridSearchOptions {
  bm25?: { enabled?: boolean; weight?: number };
  vector?: { enabled?: boolean; weight?: number };
  fusion?: 'rrf';
  topK?: number;
  finalK?: number;
  rrfK?: number;
}

export function createHybridSearchEngine(
  store: Store,
  embedder: Embedder,
  reranker: Reranker,
  opts: HybridSearchOptions = {},
): SearchEngine {
  const bm25Enabled = opts.bm25?.enabled ?? true;
  const vectorEnabled = opts.vector?.enabled ?? true;
  const topK = opts.topK ?? 20;
  const finalK = opts.finalK ?? 10;
  const rrfK = opts.rrfK ?? 60;

  return {
    async query(q, queryOpts) {
      const started = Date.now();
      const k = queryOpts.k ?? finalK;

      const lists: Array<Awaited<ReturnType<Store['searchBm25']>>> = [];
      const debug: Record<string, unknown> = {};

      if (bm25Enabled) {
        const bmStart = Date.now();
        const bm25Hits = await store.searchBm25(q, topK);
        debug.bm25_ms = Date.now() - bmStart;
        debug.bm25_count = bm25Hits.length;
        lists.push(bm25Hits);
      }

      if (vectorEnabled) {
        const embedStart = Date.now();
        const [qEmbedding] = await embedder.embed([q]);
        debug.embed_ms = Date.now() - embedStart;
        if (qEmbedding) {
          const vecStart = Date.now();
          const vecHits = await store.searchVector(qEmbedding, topK);
          debug.vector_ms = Date.now() - vecStart;
          debug.vector_count = vecHits.length;
          lists.push(vecHits);
        }
      }

      const fuseStart = Date.now();
      const fused = rrfFuse(lists, { k: rrfK, finalK });
      debug.fuse_ms = Date.now() - fuseStart;

      const rerankStart = Date.now();
      const reranked = await reranker.rerank(q, fused);
      debug.rerank_ms = Date.now() - rerankStart;

      const results = reranked.slice(0, k);
      return {
        results,
        query_ms: Date.now() - started,
        debug: queryOpts.debug ? debug : undefined,
      };
    },
  };
}
