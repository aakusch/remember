import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadEvaluationCases,
  runEvaluation,
  validateEvaluationCases,
} from '../src/evaluation/index.js';
import type { EvaluationCase, SearchResult } from '../src/index.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('evaluation runner', () => {
  it('separates warmup calls, sorts cases by id, and preserves class breakdowns', async () => {
    const cases = [fixtureCase('b', 'semantic'), fixtureCase('a', 'exact')];
    let calls = 0;
    const run = await runEvaluation(
      cases,
      async (item) => {
        calls += 1;
        return {
          results: [result(`${item.id}.md`)],
          candidates: [result(`${item.id}.md`)],
          latencyMs: item.id === 'a' ? 3 : 7,
        };
      },
      {
        engine_version: 'test',
        engine_profile: 'ci',
        corpus_id: 'fixture',
        corpus_hash: 'corpus',
        embedder_id: 'hash',
        questions_id: 'questions',
        questions_hash: 'questions-hash',
      },
      { finalK: 5, candidateK: 10, warmupQueries: 1 },
    );

    expect(calls).toBe(3);
    expect(run.cases.map((item) => item.id)).toEqual(['a', 'b']);
    expect(run.configuration.warmup_queries).toBe(1);
    expect(run.by_query_class.exact.query_count).toBe(1);
    expect(run.by_query_class.unanswerable.query_count).toBe(0);
  });

  it('loads JSONL and reports the invalid line number', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-eval-'));
    tempDirectories.push(directory);
    const validPath = path.join(directory, 'valid.jsonl');
    await fs.writeFile(
      validPath,
      `${JSON.stringify(fixtureCase('valid', 'exact'))}\n\n`,
    );
    expect(await loadEvaluationCases(validPath)).toHaveLength(1);

    const invalidPath = path.join(directory, 'invalid.jsonl');
    await fs.writeFile(
      invalidPath,
      `${JSON.stringify(fixtureCase('valid', 'exact'))}\nnot json\n`,
    );
    await expect(loadEvaluationCases(invalidPath)).rejects.toThrow(
      `${invalidPath}:2`,
    );
  });

  it('rejects inconsistent fixtures and candidate limits', async () => {
    expect(() =>
      validateEvaluationCases([
        {
          ...fixtureCase('bad', 'unanswerable'),
          answerable: false,
        },
      ]),
    ).toThrow('unanswerable but declares relevant sources');

    await expect(
      runEvaluation(
        [fixtureCase('a', 'exact')],
        async () => ({ results: [] }),
        {
          engine_version: 'test',
          engine_profile: 'ci',
          corpus_id: 'fixture',
          corpus_hash: 'corpus',
          embedder_id: 'hash',
          questions_id: 'questions',
          questions_hash: 'questions-hash',
        },
        { finalK: 10, candidateK: 5 },
      ),
    ).rejects.toThrow('candidateK');
  });
});

function fixtureCase(
  id: string,
  queryClass: EvaluationCase['queryClass'],
): EvaluationCase {
  return {
    id,
    query: id,
    queryClass,
    relevant: [{ path: `${id}.md`, relevance: 3 }],
    answerable: true,
  };
}

function result(filePath: string): SearchResult {
  return {
    path: filePath,
    chunk_idx: 0,
    snippet: '',
    frontmatter: {},
    score: 1,
    retrievers: ['bm25'],
    chunk_id: `${filePath}#0`,
  };
}
