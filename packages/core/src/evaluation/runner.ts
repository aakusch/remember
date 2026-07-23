import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  evaluateQuery,
  summarizeByQueryClass,
  summarizeEvaluation,
} from './metrics.js';
import {
  QUERY_CLASSES,
  type EvaluationCase,
  type EvaluationCaseResult,
  type EvaluationMetadata,
  type EvaluationRun,
  type EvaluationSearch,
  type QueryClass,
} from './types.js';

export interface RunEvaluationOptions {
  finalK?: number;
  candidateK?: number;
  warmupQueries?: number;
}

export async function runEvaluation(
  cases: EvaluationCase[],
  search: EvaluationSearch,
  metadata: EvaluationMetadata,
  options: RunEvaluationOptions = {},
): Promise<EvaluationRun> {
  validateEvaluationCases(cases);
  const finalK = positiveInteger(options.finalK ?? 10, 'finalK');
  const candidateK = positiveInteger(options.candidateK ?? 20, 'candidateK');
  const warmupQueries = Math.max(0, Math.floor(options.warmupQueries ?? 2));
  if (candidateK < finalK) {
    throw new Error('candidateK must be greater than or equal to finalK');
  }

  const orderedCases = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  for (const evaluationCase of orderedCases.slice(0, warmupQueries)) {
    await search(evaluationCase, { finalK, candidateK });
  }

  const results: EvaluationCaseResult[] = [];
  for (const evaluationCase of orderedCases) {
    const started = performance.now();
    const output = await search(evaluationCase, { finalK, candidateK });
    const measuredLatency = output.latencyMs ?? performance.now() - started;
    const resultPaths = distinctPaths(output.results).slice(0, finalK);
    const candidatePaths = distinctPaths(output.candidates ?? output.results).slice(
      0,
      candidateK,
    );
    results.push(
      evaluateQuery(evaluationCase, resultPaths, candidatePaths, measuredLatency),
    );
  }

  return {
    schema_version: 1,
    metadata,
    configuration: {
      final_k: finalK,
      candidate_k: candidateK,
      warmup_queries: Math.min(warmupQueries, orderedCases.length),
    },
    summary: summarizeEvaluation(results),
    by_query_class: summarizeByQueryClass(results, QUERY_CLASSES),
    cases: results,
  };
}

export async function loadEvaluationCases(filePath: string): Promise<EvaluationCase[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const cases: EvaluationCase[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      cases.push(JSON.parse(line) as EvaluationCase);
    } catch (error) {
      throw new Error(
        `invalid JSON on ${filePath}:${index + 1}: ${(error as Error).message}`,
      );
    }
  }
  validateEvaluationCases(cases);
  return cases;
}

export function validateEvaluationCases(cases: EvaluationCase[]): void {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('evaluation fixture must contain at least one case');
  }
  const ids = new Set<string>();
  for (const [index, item] of cases.entries()) {
    const location = `evaluation case ${index + 1}`;
    if (!item || typeof item !== 'object') throw new Error(`${location} must be an object`);
    if (typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error(`${location} has an invalid id`);
    }
    if (ids.has(item.id)) throw new Error(`duplicate evaluation id: ${item.id}`);
    ids.add(item.id);
    if (typeof item.query !== 'string' || !item.query.trim()) {
      throw new Error(`${location} has an invalid query`);
    }
    if (
      item.intent !== undefined &&
      (typeof item.intent !== 'string' || !item.intent.trim())
    ) {
      throw new Error(`${location} has an invalid intent`);
    }
    if (!QUERY_CLASSES.includes(item.queryClass as QueryClass)) {
      throw new Error(`${location} has an invalid queryClass`);
    }
    if (typeof item.answerable !== 'boolean') {
      throw new Error(`${location} has an invalid answerable value`);
    }
    if (!Array.isArray(item.relevant)) {
      throw new Error(`${location} has invalid relevance judgments`);
    }
    if (item.answerable && item.relevant.length === 0) {
      throw new Error(`${location} is answerable but has no relevant sources`);
    }
    if (!item.answerable && item.relevant.length > 0) {
      throw new Error(`${location} is unanswerable but declares relevant sources`);
    }
    const paths = new Set<string>();
    for (const judgment of item.relevant) {
      if (!judgment || typeof judgment.path !== 'string' || !judgment.path.trim()) {
        throw new Error(`${location} has a relevance judgment without a path`);
      }
      if (paths.has(judgment.path)) {
        throw new Error(`${location} repeats relevant path ${judgment.path}`);
      }
      paths.add(judgment.path);
      if (![1, 2, 3].includes(judgment.relevance)) {
        throw new Error(`${location} has invalid relevance for ${judgment.path}`);
      }
      if (
        judgment.chunkIds !== undefined &&
        (!Array.isArray(judgment.chunkIds) ||
          judgment.chunkIds.some((id) => typeof id !== 'string' || !id.trim()))
      ) {
        throw new Error(`${location} has invalid chunkIds for ${judgment.path}`);
      }
    }
  }
}

export async function hashFile(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

export async function hashCorpus(corpusRoot: string): Promise<string> {
  const files = await listFiles(corpusRoot);
  const hash = createHash('sha256');
  for (const file of files) {
    const relative = path.relative(corpusRoot, file).split(path.sep).join('/');
    hash.update(relative);
    hash.update('\0');
    hash.update(await fs.readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function distinctPaths(results: Array<{ path: string }>): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const result of results) {
    if (seen.has(result.path)) continue;
    seen.add(result.path);
    paths.push(result.path);
  }
  return paths;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) return listFiles(target);
      return entry.isFile() ? [target] : [];
    }),
  );
  return nested.flat().sort((a, b) => a.localeCompare(b));
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
