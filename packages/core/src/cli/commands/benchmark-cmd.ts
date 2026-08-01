import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { createHashEmbedder } from '../../embedders/hash.js';
import { createLocalOnnxEmbedder } from '../../embedders/local-onnx.js';
import { createSmartSplitChunker } from '../../chunkers/smart-split.js';
import { createRemarkParser } from '../../parsers/remark.js';
import { createChokidarWalker } from '../../walkers/chokidar.js';
import { createIndexer } from '../../indexer/index.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { createHybridSearchEngine } from '../../search/hybrid.js';
import { createPassthroughReranker } from '../../rerankers/none.js';
import {
  compareEvaluationRuns,
  hashCorpus,
  hashFile,
  loadEvaluationCases,
  runEvaluation,
} from '../../evaluation/index.js';
import type { EvaluationRun } from '../../evaluation/types.js';
import { VERSION as CORE_VERSION } from '../../version.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

export async function benchmarkCommand(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(BENCHMARK_HELP);
    return;
  }

  const profile = args.profile ?? 'ci';
  if (profile !== 'ci' && profile !== 'fast') {
    throw new Error(`unsupported benchmark profile "${profile}" (expected ci or fast)`);
  }

  const usingDefaultCorpus = args.corpus === undefined;
  const usingDefaultQuestions = args.questions === undefined;
  const corpusRoot = path.resolve(
    args.corpus ?? path.join(REPOSITORY_ROOT, 'examples/sample-wiki/content'),
  );
  const questionsPath = path.resolve(
    args.questions ??
      path.join(REPOSITORY_ROOT, 'benchmarks/retrieval/sample-wiki.questions.jsonl'),
  );
  // The default fixtures live at the repo root (examples/, benchmarks/) and are
  // NOT in the npm tarball (`files` ships only bin/dist), so a bare
  // `remember benchmark` after an npm install would ENOENT deep in the harness.
  // Fail early with an actionable message instead.
  const { existsSync } = await import('node:fs');
  const missingDefault =
    (usingDefaultCorpus && !existsSync(corpusRoot)) ||
    (usingDefaultQuestions && !existsSync(questionsPath));
  if (missingDefault) {
    throw new Error(
      'benchmark fixtures not found. The bundled sample corpus ships only in the git repo, ' +
        'not the npm package. Run this from a clone of the repo, or pass your own ' +
        '`--corpus <dir>` and `--questions <file.jsonl>`.',
    );
  }
  const finalK = parsePositiveInteger(args.k ?? '10', '--k');
  const candidateK = parsePositiveInteger(args.candidateK ?? '20', '--candidate-k');
  const warmupQueries = parseNonNegativeInteger(args.warmup ?? '2', '--warmup');
  // Optional RRF k override so before/after fusion sweeps are reproducible from
  // the committed CLI. Defaults to the engine's own default when unset.
  const rrfK = args.rrfK === undefined ? undefined : parsePositiveInteger(args.rrfK, '--rrf-k');
  // OPT-IN lexical-overlap tie-breaker (off by default). Lets us measure the
  // flag-on delta against the default-off baseline from the committed CLI.
  const lexicalTieBreak = args.lexicalTieBreak ?? false;

  const cases = await loadEvaluationCases(questionsPath);
  const embedder =
    profile === 'ci'
      ? createHashEmbedder(384)
      : createLocalOnnxEmbedder({ model: 'BAAI/bge-small-en-v1.5' });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-benchmark-'));
  const store = await createSqliteVecStore({
    path: path.join(tempRoot, 'index.db'),
    dim: embedder.dim,
  });
  store.reconcileEmbedder(embedder.modelId, embedder.dim);

  try {
    const indexer = createIndexer({
      walker: createChokidarWalker({ respectGitignore: true }),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
    });
    process.stdout.write(
      `remember benchmark: indexing ${path.basename(corpusRoot)} with ${embedder.modelId}\n`,
    );
    await indexer.indexAll(corpusRoot);

    // Keep the production-shaped result window separate from the wider
    // candidate-recall probe. This lets the v0.0.1 baseline measure the real
    // early-truncation behavior while still reporting candidate recall@K.
    const finalEngine = createHybridSearchEngine(
      store,
      embedder,
      createPassthroughReranker(),
      {
        ...(rrfK === undefined ? {} : { rrfK }),
        ...(lexicalTieBreak ? { lexicalTieBreak: true } : {}),
        limits: {
          perRetrieverK: candidateK,
          candidateK,
          finalK,
        },
      },
    );
    const candidateEngine = createHybridSearchEngine(
      store,
      embedder,
      createPassthroughReranker(),
      {
        ...(rrfK === undefined ? {} : { rrfK }),
        ...(lexicalTieBreak ? { lexicalTieBreak: true } : {}),
        limits: {
          perRetrieverK: candidateK,
          candidateK,
          finalK: candidateK,
        },
      },
    );

    const run = await runEvaluation(
      cases,
      async (evaluationCase) => {
        const queryInput = {
          query: evaluationCase.query,
          ...(evaluationCase.intent ? { intent: evaluationCase.intent } : {}),
        };
        const final = await finalEngine.query(queryInput, {
          k: finalK,
          debug: false,
        });
        const candidates = await candidateEngine.query(queryInput, {
          k: candidateK,
          debug: false,
        });
        return {
          results: final.results,
          candidates: candidates.results,
          latencyMs: final.query_ms,
        };
      },
      {
        engine_version: CORE_VERSION,
        engine_profile: profile === 'ci' ? 'ci-hash' : 'fast-local-bge',
        corpus_id: portableIdentifier(corpusRoot),
        corpus_hash: await hashCorpus(corpusRoot),
        embedder_id: embedder.modelId,
        questions_id: portableIdentifier(questionsPath),
        questions_hash: await hashFile(questionsPath),
      },
      { finalK, candidateK, warmupQueries },
    );

    printSummary(run);

    if (args.compare) {
      const baseline = JSON.parse(
        await fs.readFile(path.resolve(args.compare), 'utf8'),
      ) as EvaluationRun;
      const comparison = compareEvaluationRuns(run, baseline);
      process.stdout.write(
        `  delta vs ${baseline.metadata.engine_version}/${baseline.metadata.engine_profile}: ` +
          `recall@5 ${formatSigned(comparison.deltas.recall_at_5)}, ` +
          `MRR ${formatSigned(comparison.deltas.mrr)}, ` +
          `p95 ${formatSigned(comparison.deltas.latency_p95_ms)}ms\n`,
      );
      if (args.failOnRegression) {
        enforceRecallGate(run, baseline);
        process.stdout.write('  recall regression gate: passed\n');
      }
    } else if (args.failOnRegression) {
      throw new Error('--fail-on-regression requires --compare');
    }

    const json = `${JSON.stringify(run, null, 2)}\n`;
    if (args.output) {
      const outputPath = path.resolve(args.output);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, json);
      process.stdout.write(`  wrote ${outputPath}\n`);
    } else {
      process.stdout.write(json);
    }
  } finally {
    store.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

interface BenchmarkArgs {
  corpus?: string;
  questions?: string;
  profile?: string;
  output?: string;
  compare?: string;
  k?: string;
  candidateK?: string;
  rrfK?: string;
  warmup?: string;
  failOnRegression?: boolean;
  lexicalTieBreak?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): BenchmarkArgs {
  const args: BenchmarkArgs = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === '--') continue;
    if (token === '--fail-on-regression') {
      args.failOnRegression = true;
      continue;
    }
    if (token === '--lexical-tiebreak') {
      args.lexicalTieBreak = true;
      continue;
    }
    if (token === '-h' || token === '--help') {
      args.help = true;
      continue;
    }
    const [flag = '', inlineValue] = token.split('=', 2);
    const takesValue = [
      '--corpus',
      '--questions',
      '--profile',
      '--output',
      '--compare',
      '--k',
      '--candidate-k',
      '--rrf-k',
      '--warmup',
    ].includes(flag);
    if (!takesValue) throw new Error(`unknown benchmark option "${token}"`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    if (flag === '--corpus') args.corpus = value;
    if (flag === '--questions') args.questions = value;
    if (flag === '--profile') args.profile = value;
    if (flag === '--output') args.output = value;
    if (flag === '--compare') args.compare = value;
    if (flag === '--k') args.k = value;
    if (flag === '--candidate-k') args.candidateK = value;
    if (flag === '--rrf-k') args.rrfK = value;
    if (flag === '--warmup') args.warmup = value;
  }
  return args;
}

function printSummary(run: EvaluationRun): void {
  const summary = run.summary;
  process.stdout.write(
    [
      `  queries: ${summary.query_count} (${summary.answerable_count} answerable)`,
      `  recall@1/5/10: ${formatMetric(summary.recall_at_1)} / ${formatMetric(summary.recall_at_5)} / ${formatMetric(summary.recall_at_10)}`,
      `  candidate recall: ${formatMetric(summary.candidate_recall)}`,
      `  MRR: ${formatMetric(summary.mrr)}  nDCG@5/10: ${formatMetric(summary.ndcg_at_5)} / ${formatMetric(summary.ndcg_at_10)}`,
      `  empty/wrong-source: ${formatMetric(summary.empty_result_rate)} / ${formatMetric(summary.wrong_source_rate)}`,
      `  latency p50/p95/max: ${summary.latency_ms.p50} / ${summary.latency_ms.p95} / ${summary.latency_ms.max} ms`,
    ].join('\n') + '\n',
  );
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}

function formatSigned(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

function parsePositiveInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be >= 1`);
  return value;
}

function parseNonNegativeInteger(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${flag} must be >= 0`);
  return value;
}

function portableIdentifier(target: string): string {
  const relative = path.relative(REPOSITORY_ROOT, target).split(path.sep).join('/');
  return relative && !relative.startsWith('../') ? relative : path.basename(target);
}

function enforceRecallGate(current: EvaluationRun, baseline: EvaluationRun): void {
  const tolerance = 0.02;
  const regressions: string[] = [];
  const compare = (label: string, currentValue: number | null, baselineValue: number | null) => {
    if (
      currentValue !== null &&
      baselineValue !== null &&
      currentValue < baselineValue - tolerance
    ) {
      regressions.push(
        `${label} ${currentValue.toFixed(3)} < ${(baselineValue - tolerance).toFixed(3)}`,
      );
    }
  };
  compare('overall recall@5', current.summary.recall_at_5, baseline.summary.recall_at_5);
  for (const queryClass of Object.keys(current.by_query_class).sort()) {
    compare(
      `${queryClass} recall@5`,
      current.by_query_class[queryClass as keyof typeof current.by_query_class].recall_at_5,
      baseline.by_query_class[queryClass as keyof typeof baseline.by_query_class].recall_at_5,
    );
  }
  if (regressions.length > 0) {
    throw new Error(`recall regression gate failed: ${regressions.join('; ')}`);
  }
}

const BENCHMARK_HELP = `remember benchmark — run a versioned retrieval evaluation

USAGE:
  remember benchmark [options]

OPTIONS:
  --corpus <dir>          Markdown corpus (default: bundled sample wiki)
  --questions <jsonl>     Evaluation fixture (default: bundled fixture)
  --profile <ci|fast>     ci uses deterministic hash embeddings; fast uses local BGE
  --k <number>            Final result limit (default: 10)
  --candidate-k <number>  Candidate recall limit (default: 20)
  --rrf-k <number>        RRF fusion k (default: engine default of 10)
  --lexical-tiebreak      OPT-IN: break exact fused-score ties by lexical
                          overlap density (off by default; measurement flag)
  --warmup <number>       Warmup queries excluded from latency (default: 2)
  --output <json>         Write machine-readable results
  --compare <json>        Print metric deltas against a prior result
  --fail-on-regression    Fail when overall or per-class recall@5 drops > 0.02
  -h, --help              Show this help
`;
