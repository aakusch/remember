import { UsageError } from '../flags.js';
import path from 'node:path';
import { loadConfig } from '../../config/load.js';
import { requireWiki } from '../require-wiki.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { basenameTitle } from '../../search/title.js';
import { c, header, padEndVisible, visibleLength, fmtWhen, warn, plural } from '../format.js';

export interface ListCmdOptions {
  limit: number;
  sort: string;
  json: boolean;
  offset?: number;
  q?: string;
  filter?: Record<string, string>;
}

/** Machine-stable shape emitted by `remember list --json`. Keep field names/order stable. */
export interface ListJsonPage {
  path: string;
  title: string;
  size: number;
  last_indexed: string;
  last_modified: string;
  frontmatter: Record<string, unknown>;
}

export interface ListJsonOutput {
  count: number;
  total: number;
  limit: number;
  sort: string;
  pages: ListJsonPage[];
}

/** Sort keys accepted on the CLI (a leading `-` means descending). */
const SORT_KEYS = new Set(['path', 'title', 'size', 'modified', 'last_modified', 'last_indexed']);

function titleFrom(title: string | null, p: string): string {
  return title && title.trim() ? title.trim() : basenameTitle(p);
}

/** Parse argv for `list`. Exported for tests. */
export function parseListArgs(argv: string[]): ListCmdOptions {
  const opts: ListCmdOptions = { limit: 50, sort: 'path', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--limit' || a === '-n') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        throw new UsageError(`--limit expects a positive integer, got "${v}"`);
      }
      opts.limit = Math.min(500, Math.floor(n));
    } else if (a === '--sort' || a === '-s') {
      const v = argv[++i];
      const bare = v && v.startsWith('-') && v.length > 1 ? v.slice(1) : v;
      if (!v || !SORT_KEYS.has(bare!)) {
        throw new UsageError(
          `--sort expects one of: ${[...SORT_KEYS].join(', ')} (prefix with - for descending)`,
        );
      }
      opts.sort = v;
    } else if (a === '--offset') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) throw new UsageError('--offset expects a non-negative integer');
      opts.offset = n;
    } else if (a === '--q') {
      opts.q = argv[++i];
    } else if (a === '--filter') {
      // --filter key=value (repeatable) — exact frontmatter match.
      const kv = argv[++i] ?? '';
      const eq = kv.indexOf('=');
      if (eq <= 0) throw new UsageError('--filter expects key=value, e.g. --filter status=current');
      (opts.filter ??= {})[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a && a.startsWith('-')) {
      throw new UsageError(
        `unknown flag "${a}"\nUsage: remember list [--limit <n>] [--sort <key>] [--offset <n>] [--q <text>] [--filter key=value] [--json]`,
      );
    }
  }
  return opts;
}

/** Run the query and return the machine-stable structure (used by --json + tests). */
export async function runList(
  opts: { limit: number; sort: string; rootDir?: string; offset?: number; q?: string; filter?: Record<string, string> },
): Promise<ListJsonOutput> {
  const cfg = await loadConfig(opts.rootDir ?? process.cwd());
  await requireWiki(cfg);
  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });
  try {
    const result = await store.queryPages({
      sort: opts.sort,
      limit: opts.limit,
      offset: opts.offset ?? 0,
      q: opts.q,
      filter: opts.filter,
    });
    return {
      count: result.rows.length,
      total: result.total,
      limit: opts.limit,
      sort: opts.sort,
      pages: result.rows.map((r) => ({
        path: r.path,
        title: titleFrom(r.title, r.path),
        size: r.size,
        last_indexed: r.last_indexed,
        last_modified: r.last_modified,
        frontmatter: (r.frontmatter ?? {}) as Record<string, unknown>,
      })),
    };
  } finally {
    store.close();
  }
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function listCommand(argv: string[]): Promise<void> {
  const opts = parseListArgs(argv);
  const res = await runList({ limit: opts.limit, sort: opts.sort, offset: opts.offset, q: opts.q, filter: opts.filter });

  // ─── Machine output ──────────────────────────────────────────────────────
  if (opts.json) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  // ─── Human table ─────────────────────────────────────────────────────────
  const out = process.stdout;
  out.write(
    header(`pages ${c.dim('·')} ${plural(res.total, 'document')}`) +
      `  ${c.dim(`sorted by ${res.sort}${res.count < res.total ? `, showing ${res.count}` : ''}`)}\n`,
  );

  if (res.total === 0) {
    out.write(`\n${warn('index is empty')} ${c.dim('— run `remember index` (or `remember dev`) to build it.')}\n`);
    return;
  }

  // Column widths from visible content.
  const titleW = Math.min(
    40,
    res.pages.reduce((w, p) => Math.max(w, visibleLength(p.title)), 5),
  );
  const pathW = res.pages.reduce((w, p) => Math.max(w, visibleLength(p.path)), 4);
  const sizeStrings = res.pages.map((p) => fmtSize(p.size));
  const sizeW = sizeStrings.reduce((w, s) => Math.max(w, s.length), 4);

  out.write(
    '\n' +
      `  ${c.dim(padEndVisible('TITLE', titleW))}  ${c.dim(padEndVisible('PATH', pathW))}  ` +
      `${c.dim(padEndVisible('SIZE', sizeW))}  ${c.dim('INDEXED')}\n`,
  );
  res.pages.forEach((p, i) => {
    const title = p.title.length > titleW ? p.title.slice(0, titleW - 1) + '…' : p.title;
    out.write(
      `  ${padEndVisible(c.bold(title), titleW)}  ${padEndVisible(c.cyan(p.path), pathW)}  ` +
        `${padEndVisible(c.dim(sizeStrings[i]!), sizeW)}  ${c.dim(fmtWhen(p.last_indexed))}\n`,
    );
  });

  out.write(`\n${c.dim(`Read one: remember get <path>  ·  --json for machine output`)}\n`);
}
