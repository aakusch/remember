import type {
  RankedList,
  RankContribution,
  RetrieverName,
  SearchResult,
} from '../types.js';

export interface RrfOptions {
  k?: number;
  candidateK?: number;
  /** @deprecated Use candidateK. Kept for source compatibility. */
  finalK?: number;
}

export interface RrfFusionResult {
  results: SearchResult[];
  contributions: Map<string, RankContribution[]>;
}

/**
 * Weighted Reciprocal Rank Fusion.
 *
 * Score(d) = sum(weight(list) / (k + rank(list, d))).
 *
 * Named lists make retriever and planner-variation weights explicit while the
 * legacy SearchResult[][] input remains supported for existing callers.
 */
export function rrfFuse(
  lists: RankedList[] | SearchResult[][],
  options: RrfOptions = {},
): SearchResult[] {
  return rrfFuseWithTrace(lists, options).results;
}

export function rrfFuseWithTrace(
  lists: RankedList[] | SearchResult[][],
  options: RrfOptions = {},
): RrfFusionResult {
  const k = options.k ?? 60;
  const candidateK = options.candidateK ?? options.finalK ?? 20;
  if (!Number.isFinite(k) || k < 0) throw new Error('rrf k must be a non-negative number');
  if (!Number.isInteger(candidateK) || candidateK < 1) {
    throw new Error('rrf candidateK must be a positive integer');
  }

  const rankedLists = normalizeLists(lists);
  const accum = new Map<
    string,
    {
      result: SearchResult;
      score: number;
      retrievers: Set<RetrieverName>;
      contributions: RankContribution[];
      firstSeen: number;
    }
  >();
  let seenSequence = 0;

  for (const list of rankedLists) {
    if (!Number.isFinite(list.weight) || list.weight < 0) {
      throw new Error(`rrf list ${list.queryId} has an invalid weight`);
    }
    if (list.weight === 0) continue;
    for (let index = 0; index < list.results.length; index++) {
      const hit = list.results[index]!;
      const rank = index + 1;
      const contribution = list.weight / (k + rank);
      const detail: RankContribution = {
        retriever: list.retriever,
        query_id: list.queryId,
        rank,
        weight: list.weight,
        rrf_contribution: contribution,
      };
      const existing = accum.get(hit.chunk_id);
      if (existing) {
        existing.score += contribution;
        existing.contributions.push(detail);
        existing.retrievers.add(list.retriever);
        for (const retriever of hit.retrievers) existing.retrievers.add(retriever);
      } else {
        accum.set(hit.chunk_id, {
          result: hit,
          score: contribution,
          retrievers: new Set([list.retriever, ...hit.retrievers]),
          contributions: [detail],
          firstSeen: seenSequence++,
        });
      }
    }
  }

  const selected = Array.from(accum.values())
    .sort((left, right) => right.score - left.score || left.firstSeen - right.firstSeen)
    .slice(0, candidateK);
  const contributions = new Map<string, RankContribution[]>();
  const results = selected.map((entry) => {
    contributions.set(entry.result.chunk_id, entry.contributions);
    return {
      ...entry.result,
      score: entry.score,
      retrievers: Array.from(entry.retrievers),
    };
  });

  return { results, contributions };
}

function normalizeLists(lists: RankedList[] | SearchResult[][]): RankedList[] {
  if (lists.length === 0) return [];
  if (Array.isArray(lists[0])) {
    return (lists as SearchResult[][]).map((results, index) => ({
      retriever: inferRetriever(results),
      queryId: `legacy-${index}`,
      weight: 1,
      results,
    }));
  }
  return lists as RankedList[];
}

function inferRetriever(results: SearchResult[]): RetrieverName {
  return results[0]?.retrievers[0] ?? 'bm25';
}
