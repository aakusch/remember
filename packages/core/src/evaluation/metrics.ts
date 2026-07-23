import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationComparison,
  EvaluationMetricSummary,
  EvaluationRun,
  QueryClass,
} from './types.js';

const METRIC_PRECISION = 6;

export function evaluateQuery(
  evaluationCase: EvaluationCase,
  resultPaths: string[],
  candidatePaths: string[],
  latencyMs: number,
): EvaluationCaseResult {
  const judgments = new Map(
    evaluationCase.relevant.map((entry) => [entry.path, entry.relevance] as const),
  );
  const relevantPaths = [...judgments.keys()];
  const answerable = evaluationCase.answerable;

  const recallAt = (k: number): number | null => {
    if (!answerable || relevantPaths.length === 0) return null;
    const retrieved = new Set(resultPaths.slice(0, k));
    return round(relevantPaths.filter((path) => retrieved.has(path)).length / relevantPaths.length);
  };

  const candidateRecall =
    answerable && relevantPaths.length > 0
      ? round(
          relevantPaths.filter((path) => new Set(candidatePaths).has(path)).length /
            relevantPaths.length,
        )
      : null;

  const firstRelevantRank = resultPaths.findIndex((path) => judgments.has(path));
  const topPath = resultPaths[0];
  const wrongSource = answerable
    ? topPath !== undefined && !judgments.has(topPath)
    : resultPaths.length > 0;

  return {
    id: evaluationCase.id,
    query_class: evaluationCase.queryClass,
    answerable,
    relevant_paths: relevantPaths,
    result_paths: resultPaths,
    candidate_paths: candidatePaths,
    recall_at_1: recallAt(1),
    recall_at_5: recallAt(5),
    recall_at_10: recallAt(10),
    candidate_recall: candidateRecall,
    reciprocal_rank: firstRelevantRank === -1 ? 0 : round(1 / (firstRelevantRank + 1)),
    ndcg_at_5: answerable ? ndcgAt(resultPaths, judgments, 5) : null,
    ndcg_at_10: answerable ? ndcgAt(resultPaths, judgments, 10) : null,
    empty_result: resultPaths.length === 0,
    wrong_source: wrongSource,
    latency_ms: round(latencyMs),
  };
}

export function summarizeEvaluation(cases: EvaluationCaseResult[]): EvaluationMetricSummary {
  const answerable = cases.filter((item) => item.answerable);
  const latencies = cases.map((item) => item.latency_ms).sort((a, b) => a - b);

  return {
    query_count: cases.length,
    answerable_count: answerable.length,
    recall_at_1: averagePresent(answerable.map((item) => item.recall_at_1)),
    recall_at_5: averagePresent(answerable.map((item) => item.recall_at_5)),
    recall_at_10: averagePresent(answerable.map((item) => item.recall_at_10)),
    candidate_recall: averagePresent(answerable.map((item) => item.candidate_recall)),
    mrr: answerable.length > 0 ? average(answerable.map((item) => item.reciprocal_rank)) : null,
    ndcg_at_5: averagePresent(answerable.map((item) => item.ndcg_at_5)),
    ndcg_at_10: averagePresent(answerable.map((item) => item.ndcg_at_10)),
    empty_result_rate: rate(cases.filter((item) => item.empty_result).length, cases.length),
    wrong_source_rate: rate(cases.filter((item) => item.wrong_source).length, cases.length),
    latency_ms: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length > 0 ? round(latencies[latencies.length - 1]!) : 0,
    },
  };
}

export function summarizeByQueryClass(
  cases: EvaluationCaseResult[],
  queryClasses: readonly QueryClass[],
): Record<QueryClass, EvaluationMetricSummary> {
  return Object.fromEntries(
    queryClasses.map((queryClass) => [
      queryClass,
      summarizeEvaluation(cases.filter((item) => item.query_class === queryClass)),
    ]),
  ) as Record<QueryClass, EvaluationMetricSummary>;
}

export function compareEvaluationRuns(
  current: EvaluationRun,
  baseline: EvaluationRun,
): EvaluationComparison {
  const currentSummary = current.summary;
  const baselineSummary = baseline.summary;
  return {
    baseline: baseline.metadata,
    current: current.metadata,
    deltas: {
      recall_at_1: delta(currentSummary.recall_at_1, baselineSummary.recall_at_1),
      recall_at_5: delta(currentSummary.recall_at_5, baselineSummary.recall_at_5),
      recall_at_10: delta(currentSummary.recall_at_10, baselineSummary.recall_at_10),
      candidate_recall: delta(
        currentSummary.candidate_recall,
        baselineSummary.candidate_recall,
      ),
      mrr: delta(currentSummary.mrr, baselineSummary.mrr),
      ndcg_at_5: delta(currentSummary.ndcg_at_5, baselineSummary.ndcg_at_5),
      ndcg_at_10: delta(currentSummary.ndcg_at_10, baselineSummary.ndcg_at_10),
      empty_result_rate: round(
        currentSummary.empty_result_rate - baselineSummary.empty_result_rate,
      ),
      wrong_source_rate: round(
        currentSummary.wrong_source_rate - baselineSummary.wrong_source_rate,
      ),
      latency_p50_ms: round(
        currentSummary.latency_ms.p50 - baselineSummary.latency_ms.p50,
      ),
      latency_p95_ms: round(
        currentSummary.latency_ms.p95 - baselineSummary.latency_ms.p95,
      ),
      latency_max_ms: round(
        currentSummary.latency_ms.max - baselineSummary.latency_ms.max,
      ),
    },
  };
}

export function ndcgAt(
  resultPaths: string[],
  judgments: ReadonlyMap<string, number>,
  k: number,
): number {
  const gains = resultPaths.slice(0, k).map((path) => judgments.get(path) ?? 0);
  const idealGains = [...judgments.values()].sort((a, b) => b - a).slice(0, k);
  const ideal = dcg(idealGains);
  return ideal === 0 ? 0 : round(dcg(gains) / ideal);
}

function dcg(relevances: number[]): number {
  return relevances.reduce(
    (sum, relevance, index) =>
      sum + (Math.pow(2, relevance) - 1) / Math.log2(index + 2),
    0,
  );
}

function averagePresent(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? average(present) : null;
}

function average(values: number[]): number {
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.ceil(percentileValue * sortedValues.length) - 1);
  return round(sortedValues[index]!);
}

function delta(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  return round(current - baseline);
}

function round(value: number): number {
  return Number(value.toFixed(METRIC_PRECISION));
}
