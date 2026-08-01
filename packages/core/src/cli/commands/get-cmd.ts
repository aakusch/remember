import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadConfig } from '../../config/load.js';
import { requireWiki } from '../require-wiki.js';
import { safeJoinContent, PathOutsideContentError } from '../../api/path-utils.js';
import { c, header, keyValues } from '../format.js';

/** Machine-stable shape emitted by `remember get --json`. Keep field names/order stable. */
export interface GetJsonOutput {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  size: number;
  last_modified: string;
}

/** An error carrying a stable machine-readable `code` for --json consumers. */
export class GetError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'GetError';
  }
}

function titleFrom(frontmatter: Record<string, unknown>, p: string): string {
  const t = frontmatter.title;
  if (typeof t === 'string' && t.trim()) return t.trim();
  return path.basename(p).replace(/\.md$/i, '');
}

/** Read + parse one page. Returns the machine-stable structure (used by --json + tests). */
export async function runGet(
  userPath: string,
  opts: { rootDir?: string } = {},
): Promise<GetJsonOutput> {
  const cfg = await loadConfig(opts.rootDir ?? process.cwd());
  await requireWiki(cfg);
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);
  let abs: string;
  try {
    abs = safeJoinContent(contentRoot, userPath);
  } catch (err) {
    if (err instanceof PathOutsideContentError) {
      throw new GetError(err.code, err.message);
    }
    throw err;
  }

  let content: string;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    content = await fs.readFile(abs, 'utf8');
    stat = await fs.stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GetError(
        'PAGE_NOT_FOUND',
        `No page at "${userPath}" (relative to ${path.relative(process.cwd(), contentRoot) || '.'}). ` +
          `List indexed pages with \`remember list\`.`,
      );
    }
    throw err;
  }

  const matter = (await import('gray-matter')).default;
  const parsed = matter(content);
  const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
  return {
    path: userPath,
    title: titleFrom(frontmatter, userPath),
    frontmatter,
    body: parsed.content,
    size: stat.size,
    last_modified: stat.mtime.toISOString(),
  };
}

export interface GetCmdOptions {
  json: boolean;
  path: string;
}

export function parseGetArgs(argv: string[]): GetCmdOptions {
  const opts: GetCmdOptions = { json: false, path: '' };
  const positional: string[] = [];
  for (const a of argv) {
    if (a === '--json') opts.json = true;
    else if (a && a.startsWith('-')) {
      throw new Error(`unknown flag "${a}"\nUsage: remember get <path> [--json]`);
    } else if (a !== undefined) positional.push(a);
  }
  opts.path = positional.join(' ').trim();
  if (!opts.path) {
    throw new Error('get requires a page path\nUsage: remember get <path> [--json]\nFind a path with `remember list` or `remember search`.');
  }
  return opts;
}

export async function getCommand(argv: string[]): Promise<void> {
  const opts = parseGetArgs(argv);
  const page = await runGet(opts.path);

  // ─── Machine output ──────────────────────────────────────────────────────
  if (opts.json) {
    process.stdout.write(JSON.stringify(page, null, 2) + '\n');
    return;
  }

  // ─── Human view ──────────────────────────────────────────────────────────
  const out = process.stdout;
  out.write(`\n${c.bold(page.title)}  ${c.dim(page.path)}\n`);

  const fmRows = Object.entries(page.frontmatter).map(
    ([k, v]) => [k, formatFmValue(v)] as [string, string],
  );
  if (fmRows.length > 0) {
    out.write(header('frontmatter') + '\n' + keyValues(fmRows) + '\n');
  }

  out.write(header('content') + '\n\n');
  out.write(page.body.trimEnd() + '\n');
}

function formatFmValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (v === null || v === undefined) return c.dim('(empty)');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
