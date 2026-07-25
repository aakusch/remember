import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
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
import { createCrossEncoderReranker } from '../../rerankers/cross-encoder.js';
import {
  compareEvaluationRuns,
  hashCorpus,
  hashFile,
  loadEvaluationCases,
  runEvaluation,
} from '../../evaluation/index.js';
import type { EvaluationRun } from '../../evaluation/types.js';

const CORE_VERSION = '0.1.0';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

const CHUNKER_OPTIONS = { size: 900, overlap: 0.15 } as const;
const CHUNKER_ID = `smart-split-${CHUNKER_OPTIONS.size}-${CHUNKER_OPTIONS.overlap}`;

export interface IndexCacheKey {
  corpus_hash: string;
  embedder_id: string;
  dim: number;
  chunker_id: string;
}

interface IndexCache {
  databasePath: string;
  reusable: boolean;
  commit: () => Promise<void>;
}

/**
 * Embedding a large evaluation corpus costs minutes, and the benchmark is run
 * repeatedly while iterating on ranking. Reuse the index whenever the corpus,
 * embedder, and chunker are all unchanged; anything else must rebuild, or the
 * run would silently report stale results.
 */
export async function resolveIndexCache(
  cacheRoot: string,
  key: IndexCacheKey,
): Promise<IndexCache> {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(key))
    .digest('hex')
    .slice(0, 16);
  const entryDir = path.join(cacheRoot, fingerprint);
  const databasePath = path.join(entryDir, 'index.db');
  const manifestPath = path.join(entryDir, 'manifest.json');

  let reusable = false;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as
      | (IndexCacheKey & { complete?: boolean })
      | null;
    await fs.access(databasePath);
    reusable =
      manifest !== null &&
      manifest.complete === true &&
      manifest.corpus_hash === key.corpus_hash &&
      manifest.embedder_id === key.embedder_id &&
      manifest.dim === key.dim &&
      manifest.chunker_id === key.chunker_id;
  } catch {
    reusable = false;
  }

  if (!reusable) {
    // A partial index from an interrupted run is worse than none, so clear the
    // entry before rebuilding and only mark it complete after indexing.
    await fs.rm(entryDir, { recursive: true, force: true });
    await fs.mkdir(entryDir, { recursive: true });
  }

  return {
    databasePath,
    reusable,
    commit: async () => {
      await fs.writeFile(
        manifestPath,
        `${JSON.stringify({ ...key, complete: true }, null, 2)}\n`,
      );
    },
  };
}

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

  const corpusRoot = path.resolve(
    args.corpus ?? path.join(REPOSITORY_ROOT, 'examples/sample-wiki/content'),
  );
  const questionsPath = path.resolve(
    args.questions ??
      path.join(REPOSITORY_ROOT, 'benchmarks/retrieval/sample-wiki.questions.jsonl'),
  );
  const finalK = parsePositiveInteger(args.k ?? '10', '--k');
  const candidateK = parsePositiveInteger(args.candidateK ?? '20', '--candidate-k');
  const warmupQueries = parseNonNegativeInteger(args.warmup ?? '2', '--warmup');
  const rrfK = parseNonNegativeInteger(args.rrfK ?? '10', '--rrf-k');
  const bm25Weight = parseWeight(args.bm25Weight ?? '0.5', '--bm25-weight');
  const vectorWeight = parseWeight(args.vectorWeight ?? '0.5', '--vector-weight');
  const fusionOptions = {
    rrfK,
    bm25: { weight: bm25Weight },
    vector: { weight: vectorWeight },
  };
  // Non-default fusion settings change the numbers, so the artifact must not
  // claim to be a like-for-like baseline.
  const fusionSuffix =
    rrfK === 10 && bm25Weight === 0.5 && vectorWeight === 0.5
      ? ''
      : `+rrf${rrfK}-w${bm25Weight}/${vectorWeight}`;

  const rerankerName = args.reranker ?? 'none';
  if (rerankerName !== 'none' && rerankerName !== 'cross-encoder') {
    throw new Error(
      `unsupported reranker "${rerankerName}" (expected none or cross-encoder)`,
    );
  }

  const cases = await loadEvaluationCases(questionsPath);
  const embedder =
    profile === 'ci'
      ? createHashEmbedder(384)
      : createLocalOnnxEmbedder({
          model: 'BAAI/bge-small-en-v1.5',
          ...(args.pooling ? { pooling: args.pooling as 'mean' | 'cls' } : {}),
          ...(args.queryPrefix ? { queryPrefix: args.queryPrefix } : {}),
        });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-benchmark-'));

  // Hashed up front so it can key the index cache as well as label the artifact.
  const corpusHash = await hashCorpus(corpusRoot);
  const cache = args.indexCache
    ? await resolveIndexCache(path.resolve(args.indexCache), {
        corpus_hash: corpusHash,
        embedder_id: embedder.modelId,
        dim: embedder.dim,
        chunker_id: CHUNKER_ID,
      })
    : undefined;

  const store = await createSqliteVecStore({
    path: cache ? cache.databasePath : path.join(tempRoot, 'index.db'),
    dim: embedder.dim,
  });
  store.setDimension(embedder.dim);

  const reranker =
    rerankerName === 'cross-encoder'
      ? createCrossEncoderReranker({
          ...(args.rerankerModel ? { model: args.rerankerModel } : {}),
          topN: candidateK,
          // Snippets are query-biased 280-char excerpts; the cross-encoder
          // needs the real chunk bodies to discriminate.
          textSource: (chunkIds) => store.getChunkTexts(chunkIds),
        })
      : createPassthroughReranker();

  try {
    const indexer = createIndexer({
      walker: createChokidarWalker({ respectGitignore: true }),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker(CHUNKER_OPTIONS),
      embedder,
      store,
    });
    if (cache?.reusable) {
      process.stdout.write(
        `remember benchmark: reusing cached index for ${path.basename(corpusRoot)} ` +
          `(${embedder.modelId})\n`,
      );
    } else {
      process.stdout.write(
        `remember benchmark: indexing ${path.basename(corpusRoot)} with ${embedder.modelId}\n`,
      );
      await indexer.indexAll(corpusRoot);
      if (cache) await cache.commit();
    }

    // Keep the production-shaped result window separate from the wider
    // candidate-recall probe. This lets the v0.0.1 baseline measure the real
    // early-truncation behavior while still reporting candidate recall@K.
    const finalEngine = createHybridSearchEngine(
      store,
      embedder,
      reranker,
      {
        ...fusionOptions,
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
        ...fusionOptions,
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
        engine_profile: `${profile === 'ci' ? 'ci-hash' : 'fast-local-bge'}${
          rerankerName === 'none' ? '' : `+${rerankerName}`
        }${fusionSuffix}`,
        corpus_id: portableIdentifier(corpusRoot),
        corpus_hash: corpusHash,
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
  warmup?: string;
  indexCache?: string;
  reranker?: string;
  rerankerModel?: string;
  rrfK?: string;
  pooling?: string;
  queryPrefix?: string;
  bm25Weight?: string;
  vectorWeight?: string;
  failOnRegression?: boolean;
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
      '--warmup',
      '--index-cache',
      '--reranker',
      '--reranker-model',
      '--rrf-k',
      '--pooling',
      '--query-prefix',
      '--bm25-weight',
      '--vector-weight',
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
    if (flag === '--warmup') args.warmup = value;
    if (flag === '--index-cache') args.indexCache = value;
    if (flag === '--reranker') args.reranker = value;
    if (flag === '--reranker-model') args.rerankerModel = value;
    if (flag === '--rrf-k') args.rrfK = value;
    if (flag === '--pooling') args.pooling = value;
    if (flag === '--query-prefix') args.queryPrefix = value;
    if (flag === '--bm25-weight') args.bm25Weight = value;
    if (flag === '--vector-weight') args.vectorWeight = value;
  }
  return args;
}

function parseWeight(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return parsed;
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
  --warmup <number>       Warmup queries excluded from latency (default: 2)
  --index-cache <dir>     Reuse an index across runs when the corpus, embedder,
                          and chunker are unchanged (default: throwaway index)
  --pooling <mean|cls>    Embedding pooling (default: mean; bge models use cls)
  --query-prefix <text>   Instruction prepended to queries only
  --rrf-k <number>        RRF rank constant (default: 10)
  --bm25-weight <number>  BM25 fusion weight (default: 0.5)
  --vector-weight <num>   Vector fusion weight (default: 0.5)
  --reranker <name>       none (default) or cross-encoder
  --reranker-model <id>   Cross-encoder model (default: Xenova/ms-marco-MiniLM-L-6-v2)
  --output <json>         Write machine-readable results
  --compare <json>        Print metric deltas against a prior result
  --fail-on-regression    Fail when overall or per-class recall@5 drops > 0.02
  -h, --help              Show this help
`;
