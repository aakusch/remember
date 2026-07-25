#!/usr/bin/env node
/**
 * BEIR subset fixture tooling for retrieval evaluation.
 *
 * These fixtures exist because the bundled 30-query sample-wiki fixture is
 * saturated on the real-embedding profile (recall@5 .980), which makes ranking
 * changes unfalsifiable. See
 * docs/superpowers/specs/2026-07-24-retrieval-eval-expansion-design.md.
 *
 * Two subcommands:
 *
 *   mine   One-time authoring step. Streams a full BEIR corpus, selects
 *          queries, mines lexical hard negatives, and writes selection.json +
 *          questions.jsonl. Both outputs are committed.
 *
 *   build  Reproducible step. Reads the committed selection.json and
 *          materializes the markdown corpus. Output is gitignored; identical
 *          input always produces an identical corpus_hash.
 *
 * The split matters: mining requires a multi-gigabyte download and several
 * minutes of streaming, while `build` only needs to filter to a known ID list.
 *
 * Absolute scores from these fixtures are NOT comparable to published BEIR
 * leaderboard numbers — the corpus is a subset. Only before/after deltas on our
 * own fixture are meaningful.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATASETS = {
  hotpotqa: { queryClass: 'multi_document', goldRange: [2, 3] },
  fiqa: { queryClass: 'semantic', goldRange: [1, 3] },
};

// Terms this short or this common carry no discriminative signal, so they would
// pull generic documents into the hard-negative pool instead of confusable ones.
const MIN_TERM_LENGTH = 4;
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'been', 'before', 'being',
  'below', 'between', 'both', 'called', 'came', 'does', 'doing', 'down', 'during',
  'each', 'from', 'further', 'have', 'having', 'here', 'high', 'into', 'itself',
  'just', 'know', 'like', 'made', 'make', 'many', 'more', 'most', 'much', 'must',
  'name', 'need', 'once', 'only', 'other', 'over', 'same', 'should', 'since',
  'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'under', 'until', 'very', 'were', 'what',
  'when', 'where', 'which', 'while', 'with', 'would', 'your',
]);

function tokenize(text) {
  const out = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < MIN_TERM_LENGTH) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

/** Seeded PRNG. Math.random cannot be seeded, and fixture selection must be reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Deterministic doc id -> corpus-relative posix path, shared by mine and build. */
export function docPath(id) {
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
  return `docs/${safe}.md`;
}

function streamMember(archive, member, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', archive, member], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let failed;
    let linesClosed = false;
    let childClosed = false;
    // Resolve only once both the reader and the process are done, so a nonzero
    // unzip exit on a truncated archive cannot be mistaken for a clean pass.
    const settle = () => {
      if (!linesClosed || !childClosed) return;
      if (failed) reject(failed);
      else resolve();
    };
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (line.length === 0) return;
      try {
        onLine(line);
      } catch (error) {
        failed ??= error;
        rl.close();
        child.kill();
      }
    });
    rl.on('close', () => {
      linesClosed = true;
      settle();
    });
    child.on('error', (error) => {
      failed ??= error;
      childClosed = true;
      settle();
    });
    child.on('close', (code) => {
      if (code !== 0 && !failed) {
        failed = new Error(`unzip ${member} exited ${code}: ${stderr.trim()}`);
      }
      childClosed = true;
      settle();
    });
  });
}

async function readQrels(archive, dataset) {
  const byQuery = new Map();
  let scoreMax = 0;
  await streamMember(archive, `${dataset}/qrels/test.tsv`, (line) => {
    if (line.startsWith('query-id')) return;
    const [queryId, corpusId, rawScore] = line.split('\t');
    const score = Number(rawScore);
    if (!queryId || !corpusId || !Number.isFinite(score) || score <= 0) return;
    scoreMax = Math.max(scoreMax, score);
    if (!byQuery.has(queryId)) byQuery.set(queryId, []);
    byQuery.get(queryId).push({ corpusId, score });
  });
  return { byQuery, graded: scoreMax >= 2 };
}

async function readQueries(archive, dataset, wanted) {
  const texts = new Map();
  await streamMember(archive, `${dataset}/queries.jsonl`, (line) => {
    const row = JSON.parse(line);
    if (wanted.has(row._id)) texts.set(row._id, row.text);
  });
  return texts;
}

/**
 * Graded qrels keep their distinction (2+ strongly relevant, 1 partially).
 * Binary qrels have only one meaning, so a flat 3 is the honest mapping rather
 * than inventing a gradation the source data does not contain.
 */
function toRelevance(score, graded) {
  if (!graded) return 3;
  return score >= 2 ? 3 : 2;
}

async function mine(opts) {
  const spec = DATASETS[opts.dataset];
  if (!spec) throw new Error(`unknown dataset ${opts.dataset}`);

  const random = mulberry32(opts.seed);
  const { byQuery, graded } = await readQrels(opts.archive, opts.dataset);
  process.stdout.write(
    `${opts.dataset}: ${byQuery.size} test queries in qrels (graded=${graded})\n`,
  );

  const [minGold, maxGold] = spec.goldRange;
  const eligible = [...byQuery.keys()]
    .filter((id) => {
      const gold = byQuery.get(id).length;
      return gold >= minGold && gold <= maxGold;
    })
    .sort();

  const needed = opts.answerable + opts.unanswerable;
  if (eligible.length < needed) {
    throw new Error(`only ${eligible.length} eligible queries, need ${needed}`);
  }
  const picked = shuffled(eligible, random).slice(0, needed);
  const answerableIds = picked.slice(0, opts.answerable);
  const unanswerableIds = picked.slice(opts.answerable);

  const queryTexts = await readQueries(opts.archive, opts.dataset, new Set(picked));

  const goldByQuery = new Map();
  for (const id of picked) goldByQuery.set(id, byQuery.get(id));

  // Gold documents of unanswerable queries must never reach the corpus — their
  // absence is what makes those queries genuinely unanswerable.
  const forbidden = new Set();
  for (const id of unanswerableIds) {
    for (const { corpusId } of goldByQuery.get(id)) forbidden.add(corpusId);
  }
  const goldDocs = new Set();
  for (const id of answerableIds) {
    for (const { corpusId } of goldByQuery.get(id)) goldDocs.add(corpusId);
  }
  for (const id of goldDocs) {
    if (forbidden.has(id)) forbidden.delete(id); // answerable gold wins
  }

  // Index the answerable queries' terms so a single corpus pass can score every
  // document against every query at once.
  const termToQueries = new Map();
  answerableIds.forEach((queryId, qidx) => {
    for (const term of new Set(tokenize(queryTexts.get(queryId) ?? ''))) {
      if (!termToQueries.has(term)) termToQueries.set(term, []);
      termToQueries.get(term).push(qidx);
    }
  });

  const df = new Map();
  const candidates = answerableIds.map(() => []);
  const CANDIDATE_CAP = 3000;
  const reservoir = [];
  const RESERVOIR_SIZE = Math.max(opts.corpusSize * 2, 40000);

  let seen = 0;
  let goldSeen = 0;
  await streamMember(opts.archive, `${opts.dataset}/corpus.jsonl`, (line) => {
    const row = JSON.parse(line);
    const id = row._id;
    seen += 1;
    if (seen % 500000 === 0) process.stdout.write(`  scanned ${seen} docs\n`);
    if (goldDocs.has(id)) goldSeen += 1;
    if (forbidden.has(id)) return;

    // Reservoir sampling gives a uniform random fill without holding 5.2M ids.
    if (reservoir.length < RESERVOIR_SIZE) {
      reservoir.push(id);
    } else {
      const j = Math.floor(random() * seen);
      if (j < RESERVOIR_SIZE) reservoir[j] = id;
    }

    const title = typeof row.title === 'string' ? row.title : '';
    const body = typeof row.text === 'string' ? row.text : '';
    const tokens = new Set(tokenize(`${title} ${body.slice(0, 600)}`));
    const hits = new Map();
    for (const token of tokens) {
      const queryIdxs = termToQueries.get(token);
      if (!queryIdxs) continue;
      df.set(token, (df.get(token) ?? 0) + 1);
      for (const qidx of queryIdxs) {
        if (!hits.has(qidx)) hits.set(qidx, []);
        hits.get(qidx).push(token);
      }
    }
    for (const [qidx, terms] of hits) {
      // A single shared term is usually incidental; two or more means the
      // document is plausibly about the same thing as the query.
      if (terms.length < 2) continue;
      const bucket = candidates[qidx];
      bucket.push({ id, terms });
      if (bucket.length > CANDIDATE_CAP * 2) {
        bucket.sort((a, b) => b.terms.length - a.terms.length);
        bucket.length = CANDIDATE_CAP;
      }
    }
  });

  process.stdout.write(`  scanned ${seen} docs total\n`);
  if (goldSeen < goldDocs.size) {
    throw new Error(`only found ${goldSeen}/${goldDocs.size} gold docs in corpus`);
  }

  const idf = (term) => Math.log(1 + seen / (df.get(term) ?? 1));
  const negatives = new Set();
  candidates.forEach((bucket) => {
    const ranked = bucket
      .map(({ id, terms }) => ({
        id,
        score: terms.reduce((sum, term) => sum + idf(term), 0),
      }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, opts.negativesPerQuery);
    for (const { id } of ranked) {
      if (!goldDocs.has(id) && !forbidden.has(id)) negatives.add(id);
    }
  });

  const docIds = new Set([...goldDocs, ...negatives]);
  for (const id of reservoir) {
    if (docIds.size >= opts.corpusSize) break;
    if (forbidden.has(id)) continue;
    docIds.add(id);
  }

  const questions = [];
  for (const queryId of answerableIds) {
    const relevant = goldByQuery
      .get(queryId)
      .map(({ corpusId, score }) => ({
        path: docPath(corpusId),
        relevance: toRelevance(score, graded),
      }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    questions.push({
      id: `${opts.dataset}-${queryId}`,
      query: queryTexts.get(queryId),
      queryClass: spec.queryClass,
      relevant,
      answerable: true,
    });
  }
  for (const queryId of unanswerableIds) {
    questions.push({
      id: `${opts.dataset}-unanswerable-${queryId}`,
      query: queryTexts.get(queryId),
      queryClass: 'unanswerable',
      relevant: [],
      answerable: false,
      notes: 'Gold documents are deliberately excluded from this corpus subset.',
    });
  }

  const selection = {
    dataset: opts.dataset,
    source: `BEIR/${opts.dataset} test split`,
    seed: opts.seed,
    graded,
    negatives_per_query: opts.negativesPerQuery,
    corpus_size: docIds.size,
    gold_doc_count: goldDocs.size,
    hard_negative_count: negatives.size,
    answerable_queries: answerableIds.length,
    unanswerable_queries: unanswerableIds.length,
    excluded_doc_ids: [...forbidden].sort(),
    doc_ids: [...docIds].sort(),
  };

  await fs.mkdir(opts.out, { recursive: true });
  await fs.writeFile(
    path.join(opts.out, 'selection.json'),
    `${JSON.stringify(selection, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(opts.out, 'questions.jsonl'),
    `${questions.map((row) => JSON.stringify(row)).join('\n')}\n`,
  );

  process.stdout.write(
    `${opts.dataset}: ${questions.length} queries, ${docIds.size} docs ` +
      `(${goldDocs.size} gold, ${negatives.size} hard negatives)\n`,
  );
}

async function build(opts) {
  const selection = JSON.parse(await fs.readFile(opts.selection, 'utf8'));
  const wanted = new Set(selection.doc_ids);
  const dataset = selection.dataset;

  await fs.rm(opts.out, { recursive: true, force: true });
  await fs.mkdir(path.join(opts.out, 'docs'), { recursive: true });

  // Collect during the stream and write afterwards with bounded concurrency.
  // Firing a write per matched line would leave thousands of handles open at
  // once and hit EMFILE.
  const matched = [];
  await streamMember(opts.archive, `${dataset}/corpus.jsonl`, (line) => {
    const row = JSON.parse(line);
    if (!wanted.has(row._id)) return;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const body = typeof row.text === 'string' ? row.text.trim() : '';
    // FiQA has no titles. Emitting a synthetic heading would fabricate a signal
    // the source lacks, so headingless documents stay headingless.
    matched.push({
      file: path.join(opts.out, docPath(row._id)),
      content: title ? `# ${title}\n\n${body}\n` : `${body}\n`,
    });
  });

  const BATCH = 256;
  for (let i = 0; i < matched.length; i += BATCH) {
    await Promise.all(
      matched.slice(i, i + BATCH).map((doc) => fs.writeFile(doc.file, doc.content)),
    );
  }

  const written = matched.length;
  if (written !== wanted.size) {
    throw new Error(`wrote ${written} docs but selection lists ${wanted.size}`);
  }
  process.stdout.write(`${dataset}: materialized ${written} docs to ${opts.out}\n`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = 'true';
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { command, flags };
}

const USAGE = `Usage:
  beir-fixture.mjs mine  --dataset <hotpotqa|fiqa> --archive <zip> --out <dir>
                         [--answerable 100] [--unanswerable 15]
                         [--corpus-size 20000] [--negatives-per-query 40] [--seed 20260724]
  beir-fixture.mjs build --archive <zip> --selection <selection.json> --out <corpus dir>
`;

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === 'mine') {
    await mine({
      dataset: flags.dataset,
      archive: path.resolve(flags.archive),
      out: path.resolve(flags.out),
      answerable: Number(flags.answerable ?? 100),
      unanswerable: Number(flags.unanswerable ?? 15),
      corpusSize: Number(flags['corpus-size'] ?? 20000),
      negativesPerQuery: Number(flags['negatives-per-query'] ?? 40),
      seed: Number(flags.seed ?? 20260724),
    });
    return;
  }
  if (command === 'build') {
    await build({
      archive: path.resolve(flags.archive),
      selection: path.resolve(flags.selection),
      out: path.resolve(flags.out),
    });
    return;
  }
  process.stdout.write(USAGE);
  process.exitCode = command ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
