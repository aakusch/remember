import type { SearchResult } from '../types.js';

export const QUERY_CLASSES = [
  'exact',
  'semantic',
  'ambiguous',
  'multi_document',
  'contradictory',
  'unanswerable',
] as const;

export type QueryClass = (typeof QUERY_CLASSES)[number];

export interface EvaluationCase {
  id: string;
  query: string;
  intent?: string;
  queryClass: QueryClass;
  relevant: Array<{
    path: string;
    chunkIds?: string[];
    relevance: 1 | 2 | 3;
  }>;
  answerable: boolean;
  notes?: string;
}

export interface EvaluationSearchOutput {
  results: SearchResult[];
  /**
   * The wider pre-final candidate set when the engine exposes it. Runners may
   * use a second, wider deterministic query when this is absent.
   */
  candidates?: SearchResult[];
  latencyMs?: number;
}

export type EvaluationSearch = (
  evaluationCase: EvaluationCase,
  options: { finalK: number; candidateK: number },
) => Promise<EvaluationSearchOutput>;

export interface EvaluationCaseResult {
  id: string;
  query_class: QueryClass;
  answerable: boolean;
  relevant_paths: string[];
  result_paths: string[];
  candidate_paths: string[];
  recall_at_1: number | null;
  recall_at_5: number | null;
  recall_at_10: number | null;
  candidate_recall: number | null;
  reciprocal_rank: number;
  ndcg_at_5: number | null;
  ndcg_at_10: number | null;
  empty_result: boolean;
  wrong_source: boolean;
  latency_ms: number;
}

export interface EvaluationMetricSummary {
  query_count: number;
  answerable_count: number;
  recall_at_1: number | null;
  recall_at_5: number | null;
  recall_at_10: number | null;
  candidate_recall: number | null;
  mrr: number | null;
  ndcg_at_5: number | null;
  ndcg_at_10: number | null;
  empty_result_rate: number;
  wrong_source_rate: number;
  latency_ms: {
    p50: number;
    p95: number;
    max: number;
  };
}

export interface EvaluationMetadata {
  engine_version: string;
  engine_profile: string;
  corpus_id: string;
  corpus_hash: string;
  embedder_id: string;
  questions_id: string;
  questions_hash: string;
}

export interface EvaluationRun {
  schema_version: 1;
  metadata: EvaluationMetadata;
  configuration: {
    final_k: number;
    candidate_k: number;
    warmup_queries: number;
  };
  summary: EvaluationMetricSummary;
  by_query_class: Record<QueryClass, EvaluationMetricSummary>;
  cases: EvaluationCaseResult[];
}

export interface EvaluationComparison {
  baseline: EvaluationMetadata;
  current: EvaluationMetadata;
  deltas: {
    recall_at_1: number | null;
    recall_at_5: number | null;
    recall_at_10: number | null;
    candidate_recall: number | null;
    mrr: number | null;
    ndcg_at_5: number | null;
    ndcg_at_10: number | null;
    empty_result_rate: number;
    wrong_source_rate: number;
    latency_p50_ms: number;
    latency_p95_ms: number;
    latency_max_ms: number;
  };
}
