import { performance } from 'node:perf_hooks';
import type {
  Embedder,
  QueryInput,
  QueryPlan,
  QueryPlanner,
  QueryVariation,
  RankedList,
  RankingSignalTrace,
  Reranker,
  RerankedResult,
  RetrievalLimits,
  SearchEngine,
  SearchResult,
  SearchTimings,
  SearchTrace,
  Store,
} from '../types.js';
import { createPassthroughQueryPlanner, passthroughQueryPlan } from '../query-planners/passthrough.js';
import { rrfFuseWithTrace } from './rrf.js';
import { tokenizeQuery } from './snippet.js';

export interface HybridSearchOptions {
  bm25?: { enabled?: boolean; weight?: number };
  vector?: { enabled?: boolean; weight?: number };
  fusion?: 'rrf';
  limits?: Partial<RetrievalLimits>;
  /** @deprecated Use limits.perRetrieverK. */
  topK?: number;
  /** @deprecated Use limits.candidateK. */
  candidateK?: number;
  /** @deprecated Use limits.finalK. */
  finalK?: number;
  rrfK?: number;
  /**
   * Multiplier applied per query term found in a hit's path. A page whose
   * filename contains every query term gets the full boost.
   */
  pathBoostFactor?: number;
  /** Multiplier applied per query term found in heading_path. */
  headingBoostFactor?: number;
  /**
   * When true (default), select the best chunk per page and continue down the
   * reranked candidate list until the requested number of pages is filled.
   */
  dedupByPage?: boolean;
}

export function createHybridSearchEngine(
  store: Store,
  embedder: Embedder,
  reranker: Reranker,
  opts: HybridSearchOptions = {},
  planner: QueryPlanner = createPassthroughQueryPlanner(),
): SearchEngine {
  const bm25Enabled = opts.bm25?.enabled ?? true;
  const vectorEnabled = opts.vector?.enabled ?? true;
  const bm25Weight = validWeight(opts.bm25?.weight ?? 0.5, 'bm25');
  const vectorWeight = validWeight(opts.vector?.weight ?? 0.5, 'vector');
  const configuredLimits: RetrievalLimits = {
    perRetrieverK: positiveLimit(
      opts.limits?.perRetrieverK ?? opts.topK ?? 30,
      'perRetrieverK',
    ),
    candidateK: positiveLimit(
      opts.limits?.candidateK ?? opts.candidateK ?? 30,
      'candidateK',
    ),
    finalK: positiveLimit(opts.limits?.finalK ?? opts.finalK ?? 10, 'finalK'),
  };
  // 60 is the classic RRF constant from TREC-scale runs of thousands of
  // results. At our candidate counts (<=200) it is far too flat: rank 1 scores
  // 0.5/61 vs rank 20's 0.5/80, only 1.3x apart, so top-rank signal is nearly
  // erased. 10 measurably improves recall@5/@10 and nDCG on every fixture
  // (sample-wiki MRR .980 -> 1.000, wrong-source .200 -> .167).
  const rrfK = opts.rrfK ?? 10;
  const pathBoostFactor = opts.pathBoostFactor ?? 2;
  const headingBoostFactor = opts.headingBoostFactor ?? 1;
  const dedupByPage = opts.dedupByPage ?? true;

  return {
    async query(query, queryOpts = {}) {
      const started = performance.now();
      const input = normalizeQueryInput(query);
      const mode = queryOpts.mode ?? 'fast';
      const limits: RetrievalLimits = {
        finalK: positiveLimit(queryOpts.k ?? configuredLimits.finalK, 'k'),
        candidateK: Math.max(
          configuredLimits.candidateK,
          positiveLimit(queryOpts.k ?? configuredLimits.finalK, 'k'),
        ),
        perRetrieverK: Math.max(
          configuredLimits.perRetrieverK,
          positiveLimit(queryOpts.k ?? configuredLimits.finalK, 'k'),
        ),
      };
      const timings = emptyTimings();
      let fallback: SearchTrace['fallback'];

      if (!input.query) {
        timings.query_ms = elapsed(started);
        const trace = buildTrace({
          input,
          plannerId: planner.id,
          plan: passthroughQueryPlan(input),
          limits,
          rawCounts: { bm25: 0, vector: 0 },
          fused: [],
          deduplicated: [],
          reranked: [],
          results: [],
          ranking: [],
          timings,
        });
        return {
          results: [],
          query_ms: Math.round(timings.query_ms),
          debug: queryOpts.debug ? trace : undefined,
          trace: queryOpts.trace ? trace : undefined,
        };
      }

      const plannerStarted = performance.now();
      let plan: QueryPlan;
      try {
        plan = normalizePlan(await planner.plan(input), input);
      } catch (error) {
        plan = passthroughQueryPlan(input);
        fallback = {
          stage: 'planner',
          reason: `planner_error:${errorName(error)}`,
        };
      }
      timings.planner_ms = elapsed(plannerStarted);

      const retrievalStarted = performance.now();
      const bm25Task: Promise<RankedList[]> = bm25Enabled
        ? (async () => {
            const branchStarted = performance.now();
            const lists = await Promise.all(
              plan.lexical.map(async (variation) => ({
                retriever: 'bm25' as const,
                queryId: variation.id,
                weight: bm25Weight * variation.weight,
                results: await store.searchBm25(variation.text, limits.perRetrieverK),
              })),
            );
            timings.bm25_ms = elapsed(branchStarted);
            return lists;
          })()
        : Promise.resolve([]);

      const vectorTask: Promise<RankedList[]> = vectorEnabled
        ? (async () => {
            const embedStarted = performance.now();
            const embeddings = await embedder.embed(
              plan.semantic.map((variation) => variation.text),
              'query',
            );
            timings.embed_ms = elapsed(embedStarted);
            const vectorStarted = performance.now();
            const lists = await Promise.all(
              plan.semantic.map(async (variation, index) => {
                const embedding = embeddings[index];
                return {
                  retriever: 'vector' as const,
                  queryId: variation.id,
                  weight: vectorWeight * variation.weight,
                  results: embedding
                    ? await store.searchVector(
                        embedding,
                        limits.perRetrieverK,
                        variation.text,
                      )
                    : [],
                };
              }),
            );
            timings.vector_ms = elapsed(vectorStarted);
            return lists;
          })()
        : Promise.resolve([]);

      const [bm25Lists, vectorLists] = await Promise.all([bm25Task, vectorTask]);
      timings.candidate_retrieval_ms = elapsed(retrievalStarted);
      const rankedLists = [...bm25Lists, ...vectorLists];
      const rawCounts = {
        bm25: bm25Lists.reduce((count, list) => count + list.results.length, 0),
        vector: vectorLists.reduce((count, list) => count + list.results.length, 0),
      };

      const fusionStarted = performance.now();
      const fusion = rrfFuseWithTrace(rankedLists, {
        k: rrfK,
        candidateK: limits.candidateK,
      });
      timings.fusion_ms = elapsed(fusionStarted);
      const retrievalScores = new Map(
        fusion.results.map((result) => [result.chunk_id, result.score] as const),
      );

      const signalsStarted = performance.now();
      let signaled = applyPathBoost(fusion.results, input.query, pathBoostFactor);
      signaled = applyHeadingBoost(signaled, input.query, headingBoostFactor);
      timings.signals_ms = elapsed(signalsStarted);

      const dedupStarted = performance.now();
      const deduplicated = deduplicateChunks(signaled);
      timings.dedup_ms = elapsed(dedupStarted);

      const rerankStarted = performance.now();
      let reranked: SearchResult[];
      try {
        const output = await reranker.rerank(input.query, deduplicated, {
          intent: input.intent,
          mode,
        });
        reranked = normalizeRerankerOutput(output, deduplicated);
      } catch (error) {
        reranked = deduplicated;
        fallback ??= {
          stage: 'reranker',
          reason: `reranker_error:${errorName(error)}`,
        };
      }
      timings.rerank_ms = elapsed(rerankStarted);

      const diversityStarted = performance.now();
      const diversified = dedupByPage ? collapsePerPage(reranked) : reranked;
      const results = diversified.slice(0, limits.finalK);
      timings.diversity_ms = elapsed(diversityStarted);
      timings.query_ms = elapsed(started);

      const finalScores = new Map(
        reranked.map((result) => [result.chunk_id, result.score] as const),
      );
      // Only built when requested: this walks every candidate and does an
      // O(n^2) lookup, which is wasted work on production queries and grows
      // quadratically with candidateK.
      const wantsTrace = Boolean(queryOpts.debug || queryOpts.trace);
      const trace = wantsTrace
        ? buildTrace({
            input,
            plannerId: planner.id,
            plan,
            limits,
            rawCounts,
            fused: fusion.results,
            deduplicated,
            reranked,
            results,
            ranking: fusion.results.map((result): RankingSignalTrace => {
              const signaledResult = signaled.find(
                (candidate) => candidate.chunk_id === result.chunk_id,
              );
              return {
                chunk_id: result.chunk_id,
                retrieval_score: retrievalScores.get(result.chunk_id) ?? result.score,
                signaled_score: signaledResult?.score ?? result.score,
                final_score:
                  finalScores.get(result.chunk_id) ??
                  signaledResult?.score ??
                  result.score,
                exact_match: hasExactMatch(result, input.query),
                path_match_fraction: pathMatchFraction(result, input.query),
                heading_match_fraction: headingMatchFraction(result, input.query),
                contributions: fusion.contributions.get(result.chunk_id) ?? [],
              };
            }),
            timings,
            fallback,
          })
        : undefined;

      return {
        results,
        query_ms: Math.round(timings.query_ms),
        debug: queryOpts.debug ? trace : undefined,
        trace: queryOpts.trace ? trace : undefined,
      };
    },
  };
}

/** Keep one result per chunk ID while preserving score order. */
export function deduplicateChunks(hits: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.chunk_id)) return false;
    seen.add(hit.chunk_id);
    return true;
  });
}

/**
 * Select the highest-ranked chunk from each page. Because this runs over the
 * full candidate set before the final slice, later pages backfill duplicates.
 */
export function collapsePerPage(hits: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const output: SearchResult[] = [];
  for (const hit of hits) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    output.push(hit);
  }
  return output;
}

export function applyHeadingBoost(
  hits: SearchResult[],
  query: string,
  factor: number,
): SearchResult[] {
  if (factor <= 0) return hits;
  const boosted = hits.map((hit) => {
    const fraction = headingMatchFraction(hit, query);
    return fraction === 0 ? hit : { ...hit, score: hit.score * (1 + fraction * factor) };
  });
  boosted.sort((left, right) => right.score - left.score);
  return boosted;
}

export function applyPathBoost(
  hits: SearchResult[],
  query: string,
  factor: number,
): SearchResult[] {
  if (factor <= 0) return hits;
  const boosted = hits.map((hit) => {
    const fraction = pathMatchFraction(hit, query);
    return fraction === 0 ? hit : { ...hit, score: hit.score * (1 + fraction * factor) };
  });
  boosted.sort((left, right) => right.score - left.score);
  return boosted;
}

function pathMatchFraction(hit: SearchResult, query: string): number {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return 0;
  const pathTokens = hit.path
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .split(/[/_\-.]+/)
    .filter(Boolean);
  const tokens = new Set(pathTokens);
  return terms.filter((term) => tokens.has(term)).length / terms.length;
}

function headingMatchFraction(hit: SearchResult, query: string): number {
  const terms = tokenizeQuery(query);
  if (terms.length === 0 || !Array.isArray(hit.heading_path)) return 0;
  const tokens = new Set(
    hit.heading_path
      .filter((heading): heading is string => typeof heading === 'string')
      .flatMap((heading) => heading.toLowerCase().split(/[\s_\-.,;:!?]+/))
      .filter(Boolean),
  );
  return terms.filter((term) => tokens.has(term)).length / terms.length;
}

function hasExactMatch(hit: SearchResult, query: string): boolean {
  const phrase = tokenizeQuery(query).join(' ');
  if (!phrase) return false;
  const values = [
    hit.path.replace(/\.[a-z0-9]+$/i, '').replace(/[/_\-.]+/g, ' '),
    ...(hit.heading_path ?? []),
    hit.snippet,
  ];
  return values.some((value) => canonicalText(value).includes(phrase));
}

function normalizeQueryInput(query: string | QueryInput): QueryInput {
  const input = typeof query === 'string' ? { query } : query;
  const normalizedQuery = normalizeQueryText(input.query);
  const normalizedIntent = input.intent?.trim().replace(/\s+/g, ' ');
  return {
    query: normalizedQuery,
    ...(normalizedIntent ? { intent: normalizedIntent } : {}),
  };
}

function normalizePlan(plan: QueryPlan, input: QueryInput): QueryPlan {
  if (!plan || typeof plan !== 'object') throw new Error('planner returned no plan');
  return {
    original: input.query,
    lexical: normalizeVariations(plan.lexical, input.query),
    semantic: normalizeVariations(plan.semantic, input.query),
  };
}

function normalizeVariations(
  variations: QueryVariation[] | undefined,
  originalQuery: string,
): QueryVariation[] {
  const valid = (Array.isArray(variations) ? variations : []).filter(
    (variation) =>
      variation &&
      typeof variation.id === 'string' &&
      variation.id.trim() &&
      typeof variation.text === 'string' &&
      variation.text.trim() &&
      Number.isFinite(variation.weight) &&
      variation.weight > 0,
  );
  const originalIndex = valid.findIndex(
    (variation) =>
      variation.id === 'original' ||
      canonicalText(variation.text) === canonicalText(originalQuery),
  );
  const original =
    originalIndex >= 0
      ? { ...valid[originalIndex]!, id: 'original', text: originalQuery, weight: 1 }
      : { id: 'original', text: originalQuery, weight: 1 };
  const expansions = valid.filter((_, index) => index !== originalIndex);
  const uniqueExpansions = Array.from(
    new Map(
      expansions.map((variation) => [
        variation.id,
        {
          id: variation.id,
          text: normalizeQueryText(variation.text),
          weight: variation.weight,
        },
      ]),
    ).values(),
  );
  const expansionWeight = uniqueExpansions.reduce(
    (sum, variation) => sum + variation.weight,
    0,
  );
  const scale = expansionWeight > original.weight ? original.weight / expansionWeight : 1;
  return [
    original,
    ...uniqueExpansions.map((variation) => ({
      ...variation,
      weight: variation.weight * scale,
    })),
  ];
}

function normalizeRerankerOutput(
  output: SearchResult[],
  candidates: SearchResult[],
): SearchResult[] {
  if (!Array.isArray(output)) throw new Error('reranker returned an invalid result');
  const allowed = new Map(candidates.map((candidate) => [candidate.chunk_id, candidate] as const));
  const seen = new Set<string>();
  const normalized: SearchResult[] = [];
  for (const item of output) {
    const candidate = allowed.get(item?.chunk_id);
    if (!candidate || seen.has(candidate.chunk_id)) continue;
    seen.add(candidate.chunk_id);
    const reranked = item as Partial<RerankedResult>;
    const finalScore = Number.isFinite(reranked.finalScore)
      ? reranked.finalScore!
      : item.score;
    normalized.push({
      ...candidate,
      score: Number.isFinite(finalScore) ? finalScore : candidate.score,
      ...(Number.isFinite(reranked.retrievalScore)
        ? { retrievalScore: reranked.retrievalScore }
        : {}),
      ...(Number.isFinite(reranked.rerankerScore)
        ? { rerankerScore: reranked.rerankerScore }
        : {}),
      ...(Number.isFinite(reranked.finalScore)
        ? { finalScore: reranked.finalScore }
        : {}),
    });
  }
  for (const candidate of candidates) {
    if (!seen.has(candidate.chunk_id)) normalized.push(candidate);
  }
  return normalized;
}

function buildTrace(input: {
  input: QueryInput;
  plannerId: string;
  plan: QueryPlan;
  limits: RetrievalLimits;
  rawCounts: { bm25: number; vector: number };
  fused: SearchResult[];
  deduplicated: SearchResult[];
  reranked: SearchResult[];
  results: SearchResult[];
  ranking: RankingSignalTrace[];
  timings: SearchTimings;
  fallback?: SearchTrace['fallback'];
}): SearchTrace {
  return {
    query: {
      normalized: input.input.query,
      ...(input.input.intent ? { intent: input.input.intent } : {}),
    },
    planner: {
      id: input.plannerId,
      lexical_variation_ids: input.plan.lexical.map((variation) => variation.id),
      semantic_variation_ids: input.plan.semantic.map((variation) => variation.id),
    },
    limits: input.limits,
    candidates: {
      by_retriever: input.rawCounts,
      fused_count: input.fused.length,
      deduplicated_count: input.deduplicated.length,
      before_rerank_ids: input.deduplicated.map((result) => result.chunk_id),
      after_rerank_ids: input.reranked.map((result) => result.chunk_id),
      final_ids: input.results.map((result) => result.chunk_id),
    },
    ranking: input.ranking,
    timings: input.timings,
    ...(input.fallback ? { fallback: input.fallback } : {}),
  };
}

function emptyTimings(): SearchTimings {
  return {
    planner_ms: 0,
    bm25_ms: 0,
    embed_ms: 0,
    vector_ms: 0,
    candidate_retrieval_ms: 0,
    fusion_ms: 0,
    signals_ms: 0,
    dedup_ms: 0,
    rerank_ms: 0,
    diversity_ms: 0,
    query_ms: 0,
  };
}

function normalizeQueryText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function canonicalText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 1) throw new Error(`${name} must be >= 1`);
  return Math.floor(value);
}

function validWeight(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} weight must be a non-negative number`);
  }
  return value;
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'UnknownError';
}

function elapsed(started: number): number {
  return Number((performance.now() - started).toFixed(3));
}
