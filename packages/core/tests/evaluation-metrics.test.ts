import { describe, expect, it } from 'vitest';
import {
  compareEvaluationRuns,
  evaluateQuery,
  ndcgAt,
  summarizeEvaluation,
} from '../src/evaluation/index.js';
import type {
  EvaluationCase,
  EvaluationMetadata,
  EvaluationRun,
} from '../src/evaluation/types.js';

const metadata: EvaluationMetadata = {
  engine_version: 'test',
  engine_profile: 'ci',
  corpus_id: 'fixture',
  corpus_hash: 'corpus',
  embedder_id: 'hash',
  questions_id: 'questions',
  questions_hash: 'questions-hash',
};

function evaluationCase(overrides: Partial<EvaluationCase> = {}): EvaluationCase {
  return {
    id: 'q1',
    query: 'deploy safely',
    queryClass: 'semantic',
    relevant: [
      { path: 'deploy.md', relevance: 3 },
      { path: 'rollback.md', relevance: 2 },
    ],
    answerable: true,
    ...overrides,
  };
}

describe('retrieval evaluation metrics', () => {
  it('measures recall, reciprocal rank, and multiple relevant documents', () => {
    const result = evaluateQuery(
      evaluationCase(),
      ['unrelated.md', 'deploy.md', 'other.md', 'rollback.md'],
      ['deploy.md', 'rollback.md', 'other.md'],
      12,
    );

    expect(result.recall_at_1).toBe(0);
    expect(result.recall_at_5).toBe(1);
    expect(result.reciprocal_rank).toBe(0.5);
    expect(result.candidate_recall).toBe(1);
    expect(result.wrong_source).toBe(true);
  });

  it('scores graded relevance with nDCG and treats equal grades as ties', () => {
    const judgments = new Map([
      ['best.md', 3],
      ['good-a.md', 2],
      ['good-b.md', 2],
    ]);
    expect(ndcgAt(['best.md', 'good-a.md', 'good-b.md'], judgments, 5)).toBe(1);
    expect(ndcgAt(['best.md', 'good-b.md', 'good-a.md'], judgments, 5)).toBe(1);
    expect(ndcgAt(['good-a.md', 'best.md', 'good-b.md'], judgments, 5)).toBeLessThan(1);
  });

  it('records empty answerable results without dividing by zero', () => {
    const result = evaluateQuery(evaluationCase(), [], [], 0);
    const summary = summarizeEvaluation([result]);

    expect(result.empty_result).toBe(true);
    expect(result.recall_at_10).toBe(0);
    expect(result.reciprocal_rank).toBe(0);
    expect(summary.empty_result_rate).toBe(1);
    expect(summary.latency_ms).toEqual({ p50: 0, p95: 0, max: 0 });
  });

  it('does not invent recall for unanswerable queries and flags returned sources', () => {
    const result = evaluateQuery(
      evaluationCase({
        queryClass: 'unanswerable',
        relevant: [],
        answerable: false,
      }),
      ['guess.md'],
      ['guess.md'],
      2,
    );

    expect(result.recall_at_5).toBeNull();
    expect(result.candidate_recall).toBeNull();
    expect(result.ndcg_at_5).toBeNull();
    expect(result.wrong_source).toBe(true);
  });

  it('aggregates latency percentiles and metric deltas deterministically', () => {
    const cases = [1, 2, 3, 4, 100].map((latency, index) =>
      evaluateQuery(
        evaluationCase({ id: `q${index}` }),
        ['deploy.md'],
        ['deploy.md', 'rollback.md'],
        latency,
      ),
    );
    const summary = summarizeEvaluation(cases);
    expect(summary.latency_ms).toEqual({ p50: 3, p95: 100, max: 100 });

    const baseline = runWithSummary(summary);
    const current = runWithSummary({ ...summary, recall_at_5: 0.9 });
    expect(compareEvaluationRuns(current, baseline).deltas.recall_at_5).toBe(
      0.9 - (summary.recall_at_5 ?? 0),
    );
  });
});

function runWithSummary(summary: EvaluationRun['summary']): EvaluationRun {
  return {
    schema_version: 1,
    metadata,
    configuration: { final_k: 10, candidate_k: 20, warmup_queries: 0 },
    summary,
    by_query_class: {
      exact: summary,
      semantic: summary,
      ambiguous: summary,
      multi_document: summary,
      contradictory: summary,
      unanswerable: summary,
    },
    cases: [],
  };
}
