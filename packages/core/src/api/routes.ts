import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { safeJoinContent, PathOutsideContentError } from './path-utils.js';
import type { Embedder, SearchEngine, Store } from '../types.js';

const VERSION = '0.0.1';

export interface RouteContext {
  contentRoot: string;
  store: Store;
  embedder: Embedder;
  search: SearchEngine;
  reindex: (mode: 'incremental' | 'full') => Promise<{ files_indexed: number; chunks_added: number; duration_ms: number }>;
  reindexOne: (relPath: string) => Promise<{ chunks_added: number }>;
  adminToken: string | null;
  remoteAllowed: boolean;
  configPath: string | null;
  configRoot: string;
  getConfig: () => { name?: string; description?: string; content: string; server: { host: string; port: number; apiPort: number; adminToken: string | null }; viewer: { landing: string; showAdmin: boolean; breadcrumbs: boolean }; schemaVersion: number };
  saveConfig: (source: string) => Promise<{ ok: true; written_to: string; backup_path: string | null } | { ok: false; error: { code: string; message: string; hint?: string } }>;
  events: EventEmitter;
  connectors: {
    list: () => Array<{ name: string; kind: string; target: string; configured: boolean; last_sync_at: string | null; last_result: unknown; last_error: string | null }>;
    syncOne: (name: string) => Promise<unknown>;
    syncAll: () => Promise<Record<string, unknown>>;
  };
}

const notImplemented = (endpoint: string) => ({
  error: {
    code: 'NOT_IMPLEMENTED' as const,
    message: `${endpoint} not yet implemented`,
    hint: 'Implementation lands progressively — see docs/superpowers/specs/',
  },
});

function isLocalhost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.split(':')[0]!;
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

/**
 * Inline admin check. Returns a Response if unauthorized, null if allowed.
 * Calling it inline in each handler keeps Hono's path typing clean.
 */
function checkAdmin(c: Context, adminToken: string | null): Response | null {
  const fwdHost = c.req.header('host');
  const fromLocal = isLocalhost(fwdHost);
  if (fromLocal && !adminToken) return null;

  const auth = c.req.header('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } }, 401);
  }
  const token = auth.slice('Bearer '.length).trim();
  if (!adminToken || token !== adminToken) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid admin token' } }, 401);
  }
  return null;
}

/**
 * Read-side check — gates GETs on non-loopback exposure when a token is set.
 * Localhost reads stay open by default (preserves zero-config viewer experience).
 */
function checkRead(c: Context, adminToken: string | null): Response | null {
  const fwdHost = c.req.header('host');
  if (isLocalhost(fwdHost)) return null;
  if (!adminToken) return null;
  const auth = c.req.header('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Bearer token required for remote reads' } }, 401);
  }
  const token = auth.slice('Bearer '.length).trim();
  if (token !== adminToken) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, 401);
  }
  return null;
}

export function registerRoutes(app: Hono, ctx: RouteContext): void {
  // Apply remote-read gating to every /v1 endpoint except /health.
  app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/health') return next();
    const denial = checkRead(c, ctx.adminToken);
    if (denial) return denial;
    return next();
  });

  // Health + meta
  app.get('/v1/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/v1/openapi.json', (c) =>
    c.json({
      openapi: '3.1.0',
      info: { title: 'remember', version: VERSION },
      servers: [{ url: '/v1' }],
      paths: openApiPaths,
    }),
  );

  // Search
  app.get('/v1/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const k = Math.max(1, Math.min(50, Number(c.req.query('k') ?? '10')));
    const debug = c.req.query('debug') === '1';
    if (!q.trim()) {
      return c.json({ query: q, results: [], query_ms: 0 });
    }
    const out = await ctx.search.query(q, { k, debug });
    return c.json({ query: q, ...out });
  });

  // List pages — backed by the frontmatter-aware `pages` table.
  //   ?filter[<key>]=<value>   exact match against scalar values, or array
  //                            membership when the frontmatter value is a list
  //   ?sort=<key>|-<key>       sort ascending or descending (prefix - for desc)
  //   ?q=<text>                free-text contains on title + path
  //   ?limit + ?offset|cursor  pagination
  app.get('/v1/pages', async (c) => {
    const query = c.req.query();
    const filter: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
      const m = /^filter\[(.+)\]$/.exec(k);
      if (m && m[1] && typeof v === 'string') filter[m[1]] = v;
    }
    const limit = Math.max(1, Math.min(500, Number(query.limit ?? '50')));
    const cursor = query.cursor;
    const offset = cursor
      ? Math.max(0, Number(Buffer.from(cursor, 'base64').toString('utf8')))
      : Math.max(0, Number(query.offset ?? '0'));
    const sort = query.sort;
    const q = query.q;

    const result = await ctx.store.queryPages({
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      sort: sort || undefined,
      q: q || undefined,
      limit,
      offset,
    });

    const nextCursor =
      offset + result.rows.length < result.total
        ? Buffer.from(String(offset + result.rows.length)).toString('base64')
        : null;

    return c.json({
      pages: result.rows.map((r) => ({
        path: r.path,
        title: r.title,
        size: r.size,
        modified: r.last_modified,
        last_indexed: r.last_indexed,
        frontmatter: r.frontmatter,
      })),
      cursor: nextCursor,
      total: result.total,
      filter,
      sort: sort || null,
      q: q || null,
    });
  });

  // Distinct frontmatter keys — powers the table-view column picker.
  app.get('/v1/attrs', async (c) => {
    const keys = await ctx.store.listFrontmatterKeys();
    return c.json({ keys });
  });

  // Get one page
  app.get('/v1/pages/*', async (c) => {
    const userPath = c.req.path.replace(/^\/v1\/pages\//, '');
    const format = c.req.query('format') ?? 'json';
    try {
      const abs = safeJoinContent(ctx.contentRoot, userPath);
      const content = await fs.readFile(abs, 'utf8');
      const stat = await fs.stat(abs);
      if (format === 'text') {
        return c.text(content);
      }
      const matter = (await import('gray-matter')).default;
      const parsed = matter(content);
      return c.json({
        path: userPath,
        frontmatter: parsed.data,
        body: parsed.content,
        last_modified: stat.mtime.toISOString(),
      });
    } catch (err) {
      if (err instanceof PathOutsideContentError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: { code: 'PAGE_NOT_FOUND', message: `No page at ${userPath}` } }, 404);
      }
      throw err;
    }
  });

  // Write page (admin-gated). Editor surface for the viewer.
  app.put('/v1/pages/*', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const userPath = c.req.path.replace(/^\/v1\/pages\//, '');
    const body = (await c.req.json().catch(() => ({}))) as { body?: unknown };
    if (typeof body.body !== 'string') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'PUT /v1/pages/<path> requires { body: string } (full markdown including frontmatter)' } }, 400);
    }
    try {
      const abs = safeJoinContent(ctx.contentRoot, userPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, body.body, 'utf8');
      // Reindex just this file so the change is searchable immediately.
      const r = await ctx.reindexOne(userPath);
      ctx.events.emit('event', { type: 'page.saved', path: userPath, chunks: r.chunks_added });
      return c.json({ ok: true, indexed: r.chunks_added });
    } catch (err) {
      if (err instanceof PathOutsideContentError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      throw err;
    }
  });

  // Mutations (admin-gated inline)
  app.delete('/v1/pages/*', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const userPath = c.req.path.replace(/^\/v1\/pages\//, '');
    try {
      const abs = safeJoinContent(ctx.contentRoot, userPath);
      await fs.unlink(abs);
      const removed = await ctx.store.deleteByPath(userPath);
      await ctx.store.updateManifest(userPath, null);
      return c.json({ ok: true, removed_chunks: removed });
    } catch (err) {
      if (err instanceof PathOutsideContentError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ error: { code: 'PAGE_NOT_FOUND', message: `No page at ${userPath}` } }, 404);
      }
      throw err;
    }
  });

  app.post('/v1/pages/move', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const body = (await c.req.json()) as { from?: string; to?: string };
    if (!body.from || !body.to) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'from and to required' } }, 400);
    }
    try {
      const absFrom = safeJoinContent(ctx.contentRoot, body.from);
      const absTo = safeJoinContent(ctx.contentRoot, body.to);
      await fs.mkdir(path.dirname(absTo), { recursive: true });
      await fs.rename(absFrom, absTo);
      await ctx.store.deleteByPath(body.from);
      await ctx.store.updateManifest(body.from, null);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof PathOutsideContentError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      throw err;
    }
  });

  app.post('/v1/folders', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const body = (await c.req.json()) as { path?: string };
    if (!body.path) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'path required' } }, 400);
    }
    try {
      const abs = safeJoinContent(ctx.contentRoot, body.path);
      await fs.mkdir(abs, { recursive: true });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof PathOutsideContentError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      throw err;
    }
  });

  app.delete('/v1/folders/*', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const userPath = c.req.path.replace(/^\/v1\/folders\//, '');
    const recursive = c.req.query('recursive') === 'true';
    try {
      const abs = safeJoinContent(ctx.contentRoot, userPath);
      await fs.rm(abs, { recursive, force: false });
      const manifest = await ctx.store.getManifest();
      for (const p of Object.keys(manifest)) {
        if (p === userPath || p.startsWith(`${userPath}/`)) {
          await ctx.store.deleteByPath(p);
          await ctx.store.updateManifest(p, null);
        }
      }
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof PathOutsideContentError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      throw err;
    }
  });

  app.post('/v1/folders/rename', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const body = (await c.req.json()) as { from?: string; to?: string };
    if (!body.from || !body.to) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'from and to required' } }, 400);
    }
    try {
      const absFrom = safeJoinContent(ctx.contentRoot, body.from);
      const absTo = safeJoinContent(ctx.contentRoot, body.to);
      await fs.mkdir(path.dirname(absTo), { recursive: true });
      await fs.rename(absFrom, absTo);
      return c.json({ ok: true, message: 'Run POST /v1/index to refresh the index' });
    } catch (err) {
      if (err instanceof PathOutsideContentError) {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      throw err;
    }
  });

  // Index lifecycle
  app.post('/v1/index', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const body = (await c.req.json().catch(() => ({}))) as { mode?: 'incremental' | 'full' };
    const mode = body.mode ?? 'incremental';
    const result = await ctx.reindex(mode);
    return c.json({ ok: true, ...result });
  });

  app.get('/v1/status', async (c) => {
    const manifest = await ctx.store.getManifest();
    const pageCount = Object.keys(manifest).length;
    const chunkCount = Object.values(manifest).reduce((sum, e) => sum + e.chunk_count, 0);
    return c.json({
      index: {
        state: 'idle',
        page_count: pageCount,
        chunk_count: chunkCount,
        model: ctx.embedder.modelId,
        model_dim: ctx.embedder.dim,
      },
      version: VERSION,
    });
  });

  // Config
  app.get('/v1/config', (c) => {
    return c.json({
      config: ctx.getConfig(),
      config_path: ctx.configPath,
      config_root: ctx.configRoot,
    });
  });
  app.put('/v1/config', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;

    const body = (await c.req.json().catch(() => ({}))) as { source?: unknown };
    if (typeof body.source !== 'string' || !body.source.trim()) {
      return c.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'PUT /v1/config requires { source: string } where source is the full remember.config.ts contents',
          },
        },
        400,
      );
    }

    const result = await ctx.saveConfig(body.source);
    if (!result.ok) {
      return c.json({ error: result.error }, 500);
    }
    return c.json({
      ok: true,
      written_to: result.written_to,
      backup_path: result.backup_path,
      restart_required: true,
      hint: 'Restart the core API (Ctrl+C → remember start) to pick up the new config',
    });
  });

  // Server-Sent Events. Viewer subscribes for live reload + index status.
  app.get('/v1/events', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;

    return streamSSE(c, async (stream) => {
      const listener = async (event: { type: string } & Record<string, unknown>) => {
        try {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        } catch {
          // client disconnected — listener cleanup happens via abort signal
        }
      };
      ctx.events.on('event', listener);

      await stream.writeSSE({ event: 'connected', data: JSON.stringify({ time: Date.now() }) });

      // Heartbeat so proxies don't drop the connection during quiet periods.
      const heartbeat = setInterval(() => {
        stream
          .writeSSE({ event: 'heartbeat', data: String(Date.now()) })
          .catch(() => clearInterval(heartbeat));
      }, 25_000);

      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => {
          ctx.events.off('event', listener);
          clearInterval(heartbeat);
          resolve();
        });
      });
    });
  });

  // Connectors
  app.get('/v1/connectors', (c) => c.json({ connectors: ctx.connectors.list() }));
  app.post('/v1/connectors/:name/sync', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const name = c.req.param('name');
    const r = await ctx.connectors.syncOne(name);
    return c.json(r);
  });
  app.post('/v1/connectors/sync', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken);
    if (denial) return denial;
    const r = await ctx.connectors.syncAll();
    return c.json({ ok: true, results: r });
  });

  // AI tools surface
  app.get('/v1/tools', (c) =>
    c.json({
      tools: [
        {
          name: 'search_wiki',
          description:
            'Search this local wiki using hybrid BM25 + vector search. Returns ranked chunks with paths, snippets, and frontmatter.',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The natural-language query' },
              k: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_page',
          description: 'Fetch the full markdown of one wiki page by path.',
          input_schema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path of the page relative to the content root (e.g. "ops/runbooks/deploys.md")',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_pages',
          description: 'List wiki pages, paginated.',
          input_schema: {
            type: 'object',
            properties: {
              cursor: { type: 'string', description: 'Opaque cursor from a previous list call' },
              limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            },
          },
        },
      ],
    }),
  );
}

async function listMarkdown(root: string): Promise<Array<{ path: string; size: number; modified: string }>> {
  const out: Array<{ path: string; size: number; modified: string }> = [];
  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.remember' || e.name.startsWith('_')) continue;
        await walk(path.join(dir, e.name), rel);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        const stat = await fs.stat(path.join(dir, e.name));
        out.push({ path: rel, size: stat.size, modified: stat.mtime.toISOString() });
      }
    }
  }
  try {
    await walk(root, '');
  } catch {
    // root missing — return empty
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const openApiPaths = {
  '/health': { get: { summary: 'Liveness check' } },
  '/search': { get: { summary: 'Hybrid BM25 + vector search', parameters: [{ name: 'q', in: 'query', required: true }, { name: 'k', in: 'query' }] } },
  '/pages': { get: { summary: 'List wiki pages' } },
  '/pages/{path}': { get: { summary: 'Get one page' }, delete: { summary: 'Delete page' } },
  '/index': { post: { summary: 'Trigger reindex' } },
  '/status': { get: { summary: 'Index status' } },
  '/tools': { get: { summary: 'AI tool definitions' } },
};
