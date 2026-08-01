import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../../config/load.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { createHybridSearchEngine, type HybridSearchOptions } from '../../search/hybrid.js';
import { createPassthroughReranker } from '../../rerankers/none.js';
import { tokenizeQuery } from '../../search/snippet.js';
import type { SearchResult } from '../../types.js';
import { c, header, plural, fmtMs, warn } from '../format.js';

export interface SearchCmdOptions {
  k: number;
  json: boolean;
  open: boolean;
}

/** Machine-stable shape emitted by `--json`. Keep field names/order stable. */
export interface SearchJsonResult {
  rank: number;
  score: number;
  path: string;
  title: string;
  snippet: string;
  heading_path: string[];
  retrievers: string[];
  chunk_id: string;
  frontmatter: Record<string, unknown>;
}

export interface SearchJsonOutput {
  query: string;
  count: number;
  query_ms: number;
  results: SearchJsonResult[];
}

/** Same descriptor-unwrap the server uses, kept local so the CLI is standalone. */
function resolveHybridSearchOptions(descriptor: unknown): HybridSearchOptions {
  if (
    descriptor &&
    typeof descriptor === 'object' &&
    (descriptor as { _kind?: unknown })._kind === 'search:hybrid'
  ) {
    const options = (descriptor as { opts?: unknown }).opts;
    return options && typeof options === 'object' ? (options as HybridSearchOptions) : {};
  }
  return {};
}

/** Clamp a snippet to a tidy length for the human card, on a word boundary. */
function clampSnippet(s: string, max = 240): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const ws = cut.lastIndexOf(' ');
  return (ws > max * 0.6 ? cut.slice(0, ws) : cut).trimEnd() + ' …';
}

/** Derive a display title from frontmatter, else the file's basename. */
export function titleFor(r: SearchResult): string {
  const t = r.frontmatter?.title;
  if (typeof t === 'string' && t.trim()) return t.trim();
  const base = path.basename(r.path).replace(/\.md$/i, '');
  return base;
}

/**
 * Highlight query terms inside a snippet for the human card. Word-boundary
 * prefix match (same rule the snippet scorer uses), case preserved.
 */
function highlight(snippet: string, query: string): string {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return snippet;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Match the term plus the rest of its word so "deploy" highlights "deployment".
  return snippet.replace(new RegExp(`\\b(${escaped.join('|')})[a-z0-9_]*`, 'gi'), (m) => c.cyan(c.bold(m)));
}

/**
 * Map engine results into the machine-stable JSON shape. Pure and
 * deterministic — no color, no I/O. This is the contract scripts and agents
 * depend on, so field names, order, and types must stay stable.
 */
export function buildJsonOutput(
  query: string,
  results: SearchResult[],
  queryMs: number,
): SearchJsonOutput {
  return {
    query,
    count: results.length,
    query_ms: Math.round(queryMs),
    results: results.map((r, i) => ({
      rank: i + 1,
      score: Number(r.score.toFixed(6)),
      path: r.path,
      title: titleFor(r),
      snippet: r.snippet,
      heading_path: r.heading_path ?? [],
      retrievers: r.retrievers,
      chunk_id: r.chunk_id,
      frontmatter: r.frontmatter ?? {},
    })),
  };
}

/** Run the query and return the machine-stable structure (used by --json + tests). */
export async function runSearch(
  query: string,
  opts: { k: number; rootDir?: string },
): Promise<SearchJsonOutput & { _results: SearchResult[]; contentRoot: string }> {
  const cfg = await loadConfig(opts.rootDir ?? process.cwd());
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);
  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });
  const reconcile = store.reconcileEmbedder(embedder.modelId, embedder.dim);
  if (reconcile.changed) {
    process.stderr.write(
      `remember: index was built with a different embedder (${reconcile.previousModelId}) and was cleared — run \`remember index\` to rebuild with ${embedder.modelId}.\n`,
    );
  }

  const engine = createHybridSearchEngine(
    store,
    embedder,
    createPassthroughReranker(),
    resolveHybridSearchOptions(cfg.raw.search?.engine),
  );

  const out = await engine.query({ query }, { k: opts.k });
  store.close();

  const json = buildJsonOutput(query, out.results, out.query_ms);
  return { ...json, _results: out.results, contentRoot };
}

export async function searchCommand(argv: string[]): Promise<void> {
  const opts: SearchCmdOptions = { k: 10, json: false, open: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--open') opts.open = true;
    else if (a === '-k' || a === '--k') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`--k expects a positive integer, got "${v}"`);
      }
      opts.k = Math.min(50, Math.floor(n));
    } else if (a && a.startsWith('-')) {
      throw new Error(`unknown flag "${a}"\nUsage: remember search "<query>" [-k <n>] [--json] [--open]`);
    } else if (a !== undefined) {
      positional.push(a);
    }
  }

  const query = positional.join(' ').trim();
  if (!query) {
    throw new Error('search requires a query\nUsage: remember search "<query>" [-k <n>] [--json] [--open]');
  }

  const res = await runSearch(query, { k: opts.k });

  // ─── Machine output ──────────────────────────────────────────────────────
  if (opts.json) {
    const payload: SearchJsonOutput = {
      query: res.query,
      count: res.count,
      query_ms: res.query_ms,
      results: res.results,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  // ─── Human cards ─────────────────────────────────────────────────────────
  const out = process.stdout;
  out.write(
    header(`search ${c.dim('·')} "${c.bold(query)}"`) +
      `  ${c.dim(`${plural(res.count, 'result')} in ${fmtMs(res.query_ms)}`)}\n`,
  );

  if (res.count === 0) {
    out.write(`\n${warn('no matches')} ${c.dim('— try broader terms, or check the index with `remember status`.')}\n`);
    return;
  }

  for (const r of res.results) {
    const scoreStr = c.dim(r.score.toFixed(4));
    const rankStr = c.accent(c.bold(`${r.rank}.`.padEnd(3)));
    const heading = r.heading_path.length ? c.dim(`  ${r.heading_path.join(' › ')}`) : '';
    out.write(`\n${rankStr}${c.bold(r.title)}  ${scoreStr}\n`);
    out.write(`   ${c.cyan(r.path)}${heading}\n`);
    // Truncate for a tidy card BEFORE highlighting (so we never cut inside an
    // ANSI escape). --json keeps the full, faithful snippet.
    const snippet = highlight(clampSnippet(r.snippet.replace(/\s+/g, ' ').trim()), query);
    out.write(`   ${snippet}\n`);
  }

  out.write(`\n${c.dim('Read a full page: remember get <path>  ·  --json for machine output')}\n`);

  // ─── --open the top result ───────────────────────────────────────────────
  if (opts.open && res.results[0]) {
    const top = res.results[0];
    const abs = path.resolve(res.contentRoot, top.path);
    const editor = process.env.EDITOR || process.env.VISUAL || process.env.PAGER || 'less';
    out.write(`\n${c.dim(`opening ${top.path} in ${editor}…`)}\n`);
    await new Promise<void>((resolve) => {
      const child = spawn(editor, [abs], { stdio: 'inherit' });
      child.on('exit', () => resolve());
      child.on('error', (err) => {
        process.stderr.write(`${c.red('could not open editor')}: ${(err as Error).message}\n`);
        resolve();
      });
    });
  }
}
