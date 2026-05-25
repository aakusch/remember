import type { Embedder, Reranker, SearchEngine, Store, SearchResult } from '../types.js';
import { rrfFuse } from './rrf.js';
import { tokenizeQuery } from './snippet.js';

export interface HybridSearchOptions {
  bm25?: { enabled?: boolean; weight?: number };
  vector?: { enabled?: boolean; weight?: number };
  fusion?: 'rrf';
  topK?: number;
  finalK?: number;
  rrfK?: number;
  /**
   * Multiplier applied per query term found in a hit's path. A page whose
   * filename contains every query term (e.g. `people/alexander-the-great.md`
   * for query "alexander the great") gets the full boost; partial matches
   * scale proportionally. Set to 0 to disable. Default 2 → up to 3× score.
   */
  pathBoostFactor?: number;
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
  const pathBoostFactor = opts.pathBoostFactor ?? 2;

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
          const vecHits = await store.searchVector(qEmbedding, topK, q);
          debug.vector_ms = Date.now() - vecStart;
          debug.vector_count = vecHits.length;
          lists.push(vecHits);
        }
      }

      const fuseStart = Date.now();
      const fused = rrfFuse(lists, { k: rrfK, finalK });
      debug.fuse_ms = Date.now() - fuseStart;

      // Path-match boost: pages whose path contains query terms are usually
      // the canonical answer (e.g. `people/alexander-the-great.md` for the
      // query "alexander the great"). BM25 alone can rank a tangentially
      // mentioning short page above the canonical one because of TF/length
      // normalisation; this post-fusion pass corrects for that.
      const boostStart = Date.now();
      const boosted = applyPathBoost(fused, q, pathBoostFactor);
      debug.path_boost_ms = Date.now() - boostStart;

      const rerankStart = Date.now();
      const reranked = await reranker.rerank(q, boosted);
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

/**
 * Tokenize the path on `/_-.` boundaries, dropping the `.md` extension, then
 * count how many of the query's content-bearing tokens appear in the path.
 * Returns a multiplier that scales linearly from 1 (no terms in path) to
 * `1 + factor` (every query term in the path).
 */
export function applyPathBoost(
  hits: SearchResult[],
  query: string,
  factor: number,
): SearchResult[] {
  if (factor <= 0) return hits;
  const queryTerms = tokenizeQuery(query);
  if (queryTerms.length === 0) return hits;

  const boosted = hits.map((hit) => {
    const pathTokens = (hit.path ?? '')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '') // drop extension
      .split(/[/_\-.]+/);
    const tokenSet = new Set(pathTokens);
    const matched = queryTerms.filter((t) => tokenSet.has(t)).length;
    if (matched === 0) return hit;
    const multiplier = 1 + (matched / queryTerms.length) * factor;
    return { ...hit, score: hit.score * multiplier };
  });

  // Re-sort by boosted score.
  boosted.sort((a, b) => b.score - a.score);
  return boosted;
}
