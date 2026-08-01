import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openWiki } from '../../api/open-wiki.js';
import { AGENT_TOOL_DEFS } from '../../api/tool-defs.js';
import { projectSearchResult } from '../../search/project.js';
import { safeJoinContent, PathOutsideContentError } from '../../api/path-utils.js';
import { VERSION } from '../../version.js';
import type { SearchResult, SearchEngine, Store, Embedder } from '../../types.js';
import type { createIndexer } from '../../indexer/index.js';

/** Reuse the exact tool description served over HTTP /v1/tools + `remember tools`. */
const toolDescription = (name: string): string =>
  AGENT_TOOL_DEFS.find((d) => d.name === name)?.description ?? name;

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const errorResult = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export interface RememberMcpDeps {
  engine: SearchEngine;
  store: Pick<Store, 'queryPages'>;
  indexer: Pick<ReturnType<typeof createIndexer>, 'indexOne'>;
  contentRoot: string;
}

/**
 * Register remember's tools on an MCP server. Pure wiring over the passed-in engine
 * — no I/O of its own — so it can be exercised in-process with an in-memory
 * transport (see tests/mcp.test.ts). The tool set mirrors AGENT_TOOL_DEFS
 * (search_wiki · get_page · list_pages · write_page) so the MCP, HTTP, and CLI tool
 * surfaces stay identical.
 */
export function buildRememberMcpServer(deps: RememberMcpDeps): McpServer {
  const { engine, store, indexer, contentRoot } = deps;
  const server = new McpServer({ name: 'remember', version: VERSION });

  // ── search_wiki (recall) ─────────────────────────────────────────────────
  server.registerTool(
    'search_wiki',
    {
      description: toolDescription('search_wiki'),
      inputSchema: {
        query: z.string().max(2048).describe('The natural-language query'),
        k: z.number().int().min(1).max(50).optional().describe('How many results (default 10)'),
      },
    },
    async ({ query, k }) => {
      const out = await engine.query({ query }, { k: k ?? 10 });
      const results = (out.results as SearchResult[]).map(projectSearchResult);
      return json({ query, count: results.length, results });
    },
  );

  // ── get_page ─────────────────────────────────────────────────────────────
  server.registerTool(
    'get_page',
    {
      description: toolDescription('get_page'),
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
      description: toolDescription('list_pages'),
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
      return json({ total, pages: rows.map((r) => ({ path: r.path, title: r.title, frontmatter: r.frontmatter })) });
    },
  );

  // ── write_page (stage) ───────────────────────────────────────────────────
  server.registerTool(
    'write_page',
    {
      description: toolDescription('write_page'),
      inputSchema: {
        path: z.string().describe('Content-relative path ending in .md, e.g. "decisions/2026-08-pricing.md"'),
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

  return server;
}

/** Run the embedder's model load with stdout muted, so nothing corrupts the protocol. */
async function warmupEmbedder(embedder: Embedder): Promise<void> {
  const original = process.stdout.write.bind(process.stdout);
  // Redirect ANY stdout write (e.g. a transformers.js internal log) to stderr while
  // the model loads — stdout is the JSON-RPC channel and must stay pristine.
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) =>
    (process.stderr.write as (...a: unknown[]) => boolean)(chunk, ...args)) as typeof process.stdout.write;
  try {
    await embedder.embed(['warmup']).catch(() => undefined);
  } finally {
    process.stdout.write = original;
  }
}

/**
 * `remember mcp` — expose the wiki to any MCP client (Claude Desktop/Code, Cursor)
 * as native tools over stdio, in-process against the wiki in the current directory.
 * The "mechanism" half of agent integration; the CLAUDE.md/AGENTS.md trigger snippet
 * is the "when-to-use" half.
 *
 * stdout carries the JSON-RPC protocol, so this writes NOTHING to stdout itself —
 * all diagnostics (and the embedder model load) go to stderr.
 */
export async function mcpCommand(): Promise<void> {
  const { contentRoot, store, embedder, engine, indexer } = await openWiki(process.cwd());

  // Load the embedding model BEFORE the protocol starts (it loads lazily on first
  // embed) so a first-run download never happens mid-tool-call — and mute stdout
  // while it does, in case a dependency logs there.
  await warmupEmbedder(embedder);

  const server = buildRememberMcpServer({ engine, store, indexer, contentRoot });

  process.stderr.write(
    `remember mcp: serving ${contentRoot} over stdio (search_wiki · get_page · list_pages · write_page)\n`,
  );
  await server.connect(new StdioServerTransport());
}
