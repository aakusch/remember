import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../../config/load.js';
import { requireWiki } from '../require-wiki.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { createHybridSearchEngine, type HybridSearchOptions } from '../../search/hybrid.js';
import { createPassthroughReranker } from '../../rerankers/none.js';
import { createIndexer } from '../../indexer/index.js';
import { createChokidarWalker } from '../../walkers/chokidar.js';
import { createRemarkParser } from '../../parsers/remark.js';
import { createSmartSplitChunker } from '../../chunkers/smart-split.js';
import { safeJoinContent, PathOutsideContentError } from '../../api/path-utils.js';
import { titleFor } from '../../search/title.js';
import { VERSION } from '../../version.js';
import type { SearchResult } from '../../types.js';

/** Same descriptor-unwrap the CLI/API use, kept local so this command is standalone. */
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

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const errorResult = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
});

/**
 * `remember mcp` — expose the wiki to any MCP client (Claude Desktop/Code, Cursor,
 * …) as native tools over stdio. It's the *mechanism* half of agent integration;
 * the CLAUDE.md/AGENTS.md trigger snippet is the *when-to-use* half.
 *
 * Runs in-process against the wiki in the current directory — no HTTP server
 * needed. CRITICAL: stdout carries the JSON-RPC protocol, so this command writes
 * NOTHING to stdout itself; all diagnostics go to stderr.
 */
export async function mcpCommand(): Promise<void> {
  const cfg = await loadConfig(process.cwd());
  await requireWiki(cfg);
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);
  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });
  store.reconcileEmbedder(embedder.modelId, embedder.dim);

  const engine = createHybridSearchEngine(
    store,
    embedder,
    createPassthroughReranker(),
    resolveHybridSearchOptions(cfg.raw.search?.engine),
  );
  const indexer = createIndexer({
    walker: createChokidarWalker({ respectGitignore: true }),
    parser: createRemarkParser(),
    chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
    embedder,
    store,
  });

  const server = new McpServer({ name: 'remember', version: VERSION });

  // ── search_wiki (recall) ─────────────────────────────────────────────────
  server.registerTool(
    'search_wiki',
    {
      description:
        'Search the local remember wiki (hybrid BM25 + vector). Use when the user asks you to recall ' +
        'something ("remember when we…", "remember how we…"). Returns ranked pages with path, title, ' +
        'snippet, and frontmatter. A result is ranked text for the query, NOT proof an answer exists — ' +
        'read the top pages before relying on them; `score` is a rank, not a probability.',
      inputSchema: {
        query: z.string().max(2048).describe('The natural-language query'),
        k: z.number().int().min(1).max(50).optional().describe('How many results (default 10)'),
      },
    },
    async ({ query, k }) => {
      const out = await engine.query({ query }, { k: k ?? 10 });
      const results = (out.results as SearchResult[]).map((r) => ({
        path: r.path,
        title: titleFor(r),
        snippet: r.snippet,
        score: r.score,
        frontmatter: r.frontmatter,
        heading_path: r.heading_path ?? [],
      }));
      return json({ query, count: results.length, results });
    },
  );

  // ── get_page ─────────────────────────────────────────────────────────────
  server.registerTool(
    'get_page',
    {
      description: 'Fetch the full markdown of one wiki page by its content-relative path (as returned by search_wiki).',
      inputSchema: { path: z.string().describe('Path relative to content/, e.g. "ops/deploy.md"') },
    },
    async ({ path: pagePath }) => {
      try {
        const abs = safeJoinContent(contentRoot, pagePath);
        const body = await fs.readFile(abs, 'utf8');
        return json({ path: pagePath, body });
      } catch (err) {
        if (err instanceof PathOutsideContentError) return errorResult(err.message);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return errorResult(`No page at ${pagePath}`);
        return errorResult((err as Error).message);
      }
    },
  );

  // ── list_pages ───────────────────────────────────────────────────────────
  server.registerTool(
    'list_pages',
    {
      description: 'List indexed wiki pages, with optional frontmatter filter, free-text match, and sort.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        q: z.string().max(2048).optional().describe('Free-text contains on title + path'),
        filter: z.record(z.string(), z.string()).optional().describe('Exact frontmatter match, e.g. { status: "current" }'),
        sort: z.string().optional().describe('Sort key; prefix "-" for descending (path|title|size|modified|last_indexed)'),
      },
    },
    async ({ limit, offset, q, filter, sort }) => {
      const { rows, total } = await store.queryPages({ limit, offset, q, filter, sort });
      return json({
        total,
        pages: rows.map((r) => ({ path: r.path, title: r.title, frontmatter: r.frontmatter })),
      });
    },
  );

  // ── write_page (stage) ───────────────────────────────────────────────────
  server.registerTool(
    'write_page',
    {
      description:
        'Save a markdown page into the wiki. Use when the user asks you to STAGE something ("we should ' +
        'remember this", "add this to the wiki"). Writes the file under content/ and indexes it so it is ' +
        'immediately findable. Give it a clear title (in the body as an `# H1`) and optional frontmatter.',
      inputSchema: {
        path: z
          .string()
          .describe('Content-relative path ending in .md, e.g. "decisions/2026-08-pricing.md"'),
        body: z.string().describe('The full markdown content of the page'),
      },
    },
    async ({ path: pagePath, body }) => {
      try {
        const rel = /\.md$/i.test(pagePath) ? pagePath : `${pagePath}.md`;
        const abs = safeJoinContent(contentRoot, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, body, 'utf8');
        const { chunks_added } = await indexer.indexOne(contentRoot, rel);
        return json({ ok: true, path: rel, chunks_indexed: chunks_added });
      } catch (err) {
        if (err instanceof PathOutsideContentError) return errorResult(err.message);
        return errorResult((err as Error).message);
      }
    },
  );

  // Diagnostics to STDERR only — stdout is the protocol channel.
  process.stderr.write(
    `remember mcp: serving ${contentRoot} over stdio (search_wiki · get_page · list_pages · write_page)\n`,
  );
  await server.connect(new StdioServerTransport());
}
