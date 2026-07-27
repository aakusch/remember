import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getConnInfo } from '@hono/node-server/conninfo';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { safeJoinContent, PathOutsideContentError } from './path-utils.js';
import type { Embedder, SearchEngine, Store } from '../types.js';
import type { LogBuffer, LogLevel } from '../observability/log-buffer.js';
import type { HistoryEntry, HistoryFull, HistoryWriteInput } from '../stores/sqlite-vec.js';
import { VERSION } from '../version.js';

/** Max bytes accepted for a single PUT /v1/pages body (memory-DoS guard). */
const MAX_PAGE_BODY_BYTES = 5 * 1024 * 1024;

export interface RouteContext {
  contentRoot: string;
  store: Store;
  embedder: Embedder;
  search: SearchEngine;
  reindex: (mode: 'incremental' | 'full') => Promise<{ files_indexed: number; chunks_added: number; duration_ms: number }>;
  reindexOne: (relPath: string) => Promise<{ chunks_added: number }>;
  adminToken: string | null;
  /**
   * The host the server is actually bound to (server.host). This is the
   * AUTHORITATIVE signal for "is this a trusted local request" — never the
   * client-supplied Host / X-Forwarded-Host header. See isTrustedLocal().
   */
  boundHost: string;
  remoteAllowed: boolean;
  configPath: string | null;
  configRoot: string;
  getConfig: () => { name?: string; description?: string; content: string; server: { host: string; port: number; apiPort: number; adminToken: string | null }; viewer: { landing: string; showAdmin: boolean; breadcrumbs: boolean }; schemaVersion: number };
  saveConfig: (source: string) => Promise<{ ok: true; written_to: string; backup_path: string | null } | { ok: false; error: { code: string; message: string; hint?: string } }>;
  reloadConfig?: () => Promise<{ ok: true; reloaded_at: string } | { ok: false; error: { code: string; message: string; hint?: string } }>;
  logs?: LogBuffer;
  history?: {
    append: (input: HistoryWriteInput) => number;
    list: (path: string, limit?: number) => HistoryEntry[];
    get: (id: number) => HistoryFull | null;
    prune: (path: string, keep?: number) => number;
  };
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

/** True for any loopback hostname form. Used on the BOUND host (trusted), never on the client Host header. */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  // Strip a trailing :port and any IPv6 brackets.
  let h = host.trim();
  if (h.startsWith('[')) {
    const close = h.indexOf(']');
    h = close >= 0 ? h.slice(1, close) : h.slice(1);
  } else if (h.includes(':') && h.split(':').length === 2) {
    // host:port (IPv4 or hostname). Bare "::1" has >2 segments, so it's left intact.
    h = h.split(':')[0]!;
  }
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h.startsWith('127.');
}

/** True if an IP literal (from the real socket) is a loopback address. */
function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  let a = addr.trim();
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) and bracketed forms.
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const mapped = a.toLowerCase().replace(/^::ffff:/, '');
  return mapped === '::1' || mapped === '127.0.0.1' || mapped.startsWith('127.');
}

/**
 * Decide whether a request is a trusted LOCAL request — based on the real
 * connection, NOT the client-supplied Host / X-Forwarded-Host header.
 *
 * Why: the Host header is attacker-controlled. A previous bug short-circuited
 * `if (isLocalhost(Host)) return trusted` BEFORE any token check, so a remote
 * client sending `Host: localhost` to a 0.0.0.0-bound server bypassed read
 * auth and could read /v1/config (which leaks adminToken → write/RCE).
 *
 * Rules:
 *  - Bound to a loopback interface (127.x / ::1 / localhost): the OS only
 *    routes genuine loopback traffic here, so every request is trusted-local.
 *  - Bound to 0.0.0.0 / a public host: do NOT trust the Host header. Use the
 *    real peer address from @hono/node-server (incoming.socket.remoteAddress)
 *    and trust only when that actual IP is loopback. If the peer address is
 *    unavailable (e.g. unit tests, non-node adapters), grant NO local-trust —
 *    callers fall through to the Bearer-token requirement.
 */
function isTrustedLocal(c: Context, boundHost: string): boolean {
  if (isLoopbackHost(boundHost)) return true;
  // Non-loopback bind: the only trustworthy "local" signal is the real socket.
  try {
    const info = getConnInfo(c);
    return isLoopbackAddress(info.remote.address);
  } catch {
    // No node-server binding on c.env (peer address unknown) → not trusted.
    return false;
  }
}

/**
 * Inline admin check. Returns a Response if unauthorized, null if allowed.
 * Calling it inline in each handler keeps Hono's path typing clean.
 */
function checkAdmin(c: Context, adminToken: string | null, boundHost: string): Response | null {
  if (isTrustedLocal(c, boundHost) && !adminToken) return null;

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
 * Trusted-local reads stay open by default (preserves zero-config viewer
 * experience). Trust derives from the real connection, never the Host header.
 */
function checkRead(c: Context, adminToken: string | null, boundHost: string): Response | null {
  if (isTrustedLocal(c, boundHost)) return null;
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
    const denial = checkRead(c, ctx.adminToken, ctx.boundHost);
    if (denial) return denial;
    return next();
  });

  // Health + meta
  app.get('/v1/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/v1/openapi.json', (c) =>
    c.json({
      openapi: '3.1.0',
      info: {
        title: 'remember',
        version: VERSION,
        description:
          '@useremember/core — local-first AI-ready wiki. ' +
          'Endpoints marked with `adminToken` require Authorization: Bearer <token> ' +
          'when the server is bound to a non-loopback host, or for any write operation.',
        license: { name: 'MIT' },
      },
      servers: [{ url: '/v1' }],
      paths: openApiPaths,
      components: {
        securitySchemes: {
          adminToken: {
            type: 'http',
            scheme: 'bearer',
            description: 'The adminToken from remember.config.ts (or REMEMBER_ADMIN_TOKEN env).',
          },
        },
      },
      tags: [
        { name: 'system', description: 'Health + spec' },
        { name: 'search', description: 'Hybrid retrieval and AI tool defs' },
        { name: 'pages', description: 'Page CRUD + frontmatter' },
        { name: 'folders', description: 'Folder lifecycle' },
        { name: 'index', description: 'Reindex trigger + status' },
        { name: 'config', description: 'Live config get/set + hot-reload' },
        { name: 'observability', description: 'Logs + live events' },
        { name: 'connectors', description: 'External-source sync' },
      ],
    }),
  );

  // Search
  app.get('/v1/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const k = Math.max(1, Math.min(50, Number(c.req.query('k') ?? '10')));
    const debug = c.req.query('debug') === '1';
    const intent = c.req.query('intent')?.trim();
    const modeParam = c.req.query('mode') ?? 'fast';
    if (modeParam !== 'fast' && modeParam !== 'enhanced') {
      return c.json(
        {
          error: {
            code: 'INVALID_SEARCH_MODE',
            message: 'mode must be "fast" or "enhanced"',
          },
        },
        400,
      );
    }
    if (!q.trim()) {
      return c.json({ query: q, results: [], query_ms: 0 });
    }
    const out = await ctx.search.query(
      { query: q, ...(intent ? { intent } : {}) },
      { k, debug, mode: modeParam },
    );
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
    const rawPath = c.req.path.replace(/^\/v1\/pages\//, '');

    // Dispatch /v1/pages/<path>/history here because Hono's wildcard match
    // swallows the more-specific route. Read-only listing — gated like other
    // GETs (localhost reads are open even with a token set).
    if (rawPath.endsWith('/history')) {
      const denial = checkRead(c, ctx.adminToken, ctx.boundHost);
      if (denial) return denial;
      const pagePath = rawPath.slice(0, -'/history'.length);
      const url = new URL(c.req.url);
      const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
      if (!ctx.history) return c.json({ entries: [], note: 'No history backend available.' });
      const entries = ctx.history.list(pagePath, isNaN(limit) ? 10 : limit);
      return c.json({ entries, total: entries.length });
    }

    const userPath = rawPath;
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
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
    if (denial) return denial;
    const userPath = c.req.path.replace(/^\/v1\/pages\//, '');
    const body = (await c.req.json().catch(() => ({}))) as { body?: unknown };
    if (typeof body.body !== 'string') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'PUT /v1/pages/<path> requires { body: string } (full markdown including frontmatter)' } }, 400);
    }
    // Reject oversized writes rather than buffering + reindexing huge payloads.
    // Why: same memory-DoS class as the walker/indexOne size caps.
    if (Buffer.byteLength(body.body, 'utf8') > MAX_PAGE_BODY_BYTES) {
      return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: `Page body exceeds ${MAX_PAGE_BODY_BYTES} bytes` } }, 413);
    }
    try {
      const abs = safeJoinContent(ctx.contentRoot, userPath);

      // Snapshot the existing file (if any) into page_history before overwriting.
      // Lets users roll back a save and gives the editor a per-page change log.
      if (ctx.history) {
        try {
          const prev = await fs.readFile(abs, 'utf8');
          ctx.history.append({ path: userPath, body: prev });
          ctx.history.prune(userPath, 50);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            // Snapshot failure is non-fatal — log it and continue with the save.
            ctx.logs?.push({
              level: 'warn',
              source: 'history',
              message: `Failed to snapshot ${userPath} before save: ${(err as Error).message}`,
            });
          }
        }
      }

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

  // Page history — get one version's full body + frontmatter.
  app.get('/v1/history/:id', (c) => {
    const denial = checkRead(c, ctx.adminToken, ctx.boundHost);
    if (denial) return denial;
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id) || !ctx.history) return c.json({ error: { code: 'NOT_FOUND', message: 'history entry not found' } }, 404);
    const entry = ctx.history.get(id);
    if (!entry) return c.json({ error: { code: 'NOT_FOUND', message: `no history entry with id ${id}` } }, 404);
    return c.json({ entry });
  });

  // Mutations (admin-gated inline)
  app.delete('/v1/pages/*', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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
    // Security: this endpoint is read-gated by the global /v1/* checkRead
    // middleware, but it dumped the raw adminToken (which gates writes / RCE via
    // PUT /v1/config) to every read-authorized caller — including any local
    // process on a loopback bind. Redact the token from the payload so its value
    // never crosses the wire. Read access to the non-secret config is unchanged.
    const config = ctx.getConfig();
    const redacted = {
      ...config,
      server: { ...config.server, adminToken: config.server.adminToken ? '***redacted***' : null },
    };
    return c.json({
      config: redacted,
      config_path: ctx.configPath,
      config_root: ctx.configRoot,
    });
  });
  app.put('/v1/config', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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

    // Try hot-reload. Falls back to restart-required if no reloadConfig handler
    // is wired or if rebuilding the pipeline from the new config fails.
    if (ctx.reloadConfig) {
      const reload = await ctx.reloadConfig();
      if (reload.ok) {
        return c.json({
          ok: true,
          written_to: result.written_to,
          backup_path: result.backup_path,
          restart_required: false,
          reloaded_at: reload.reloaded_at,
        });
      }
      return c.json({
        ok: true,
        written_to: result.written_to,
        backup_path: result.backup_path,
        restart_required: true,
        reload_failed: reload.error,
        hint: `Config saved but hot-reload failed: ${reload.error.message}. Restart with: Ctrl+C → remember start`,
      });
    }

    return c.json({
      ok: true,
      written_to: result.written_to,
      backup_path: result.backup_path,
      restart_required: true,
      hint: 'Restart the core API (Ctrl+C → remember start) to pick up the new config',
    });
  });

  // Recent operational events — errors, warnings, lifecycle. Powers the
  // Diagnostics page. Capped at ~50 entries in-memory; not durable.
  app.get('/v1/logs', (c) => {
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
    if (denial) return denial;

    const url = new URL(c.req.url);
    const level = (url.searchParams.get('level') ?? undefined) as LogLevel | undefined;
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200) : 50;

    if (!ctx.logs) {
      return c.json({ entries: [], total: 0, note: 'No log buffer attached to this server.' });
    }

    const entries = ctx.logs.list({ level, limit });
    return c.json({ entries, total: ctx.logs.size() });
  });

  // Server-Sent Events. Viewer subscribes for live reload + index status.
  app.get('/v1/events', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
    if (denial) return denial;
    const name = c.req.param('name');
    const r = await ctx.connectors.syncOne(name);
    return c.json(r);
  });
  app.post('/v1/connectors/sync', async (c) => {
    const denial = checkAdmin(c, ctx.adminToken, ctx.boundHost);
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
              intent: {
                type: 'string',
                description: 'Optional purpose used for planning and reranking, not corpus content',
              },
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

const stringParam = (name: string, where: 'query' | 'path', required = false, description?: string) => ({
  name,
  in: where,
  required,
  schema: { type: 'string' },
  ...(description ? { description } : {}),
});
const intParam = (name: string, where: 'query' | 'path', description?: string) => ({
  name,
  in: where,
  schema: { type: 'integer' },
  ...(description ? { description } : {}),
});

const jsonResponse = (description: string) => ({
  [200]: { description, content: { 'application/json': {} } },
});

const openApiPaths = {
  // ─── Liveness ──────────────────────────────────────────────────────────
  '/health': {
    get: {
      summary: 'Liveness check',
      tags: ['system'],
      responses: jsonResponse('ok'),
    },
  },
  '/openapi.json': {
    get: {
      summary: 'This OpenAPI document',
      tags: ['system'],
      responses: jsonResponse('OpenAPI spec'),
    },
  },

  // ─── Search ────────────────────────────────────────────────────────────
  '/search': {
    get: {
      summary: 'Hybrid BM25 + vector + RRF fusion search',
      tags: ['search'],
      parameters: [
        stringParam('q', 'query', true, 'Search query'),
        stringParam('intent', 'query', false, 'Optional search intent'),
        stringParam('mode', 'query', false, 'fast (default) or enhanced'),
        intParam('k', 'query', 'Max results (default 10)'),
        intParam('debug', 'query', '1 to include per-stage timings'),
      ],
      responses: jsonResponse('search hits with snippets, sources, and ranking'),
    },
  },
  '/tools': {
    get: {
      summary: 'AI tool definitions (Anthropic / OpenAI schemas)',
      tags: ['search'],
      responses: jsonResponse('tool schemas: search_wiki, get_page, list_pages'),
    },
  },

  // ─── Pages ─────────────────────────────────────────────────────────────
  '/pages': {
    get: {
      summary: 'List + filter + sort pages',
      tags: ['pages'],
      parameters: [
        stringParam('q', 'query', false, 'FTS over page bodies'),
        stringParam('sort', 'query', false, 'Sort by frontmatter key, prefix with - for desc'),
        intParam('limit', 'query'),
        intParam('offset', 'query'),
      ],
      responses: jsonResponse('paginated page list with frontmatter'),
    },
  },
  '/pages/{path}': {
    get: {
      summary: 'Get one page (markdown + frontmatter)',
      tags: ['pages'],
      parameters: [
        stringParam('path', 'path', true, 'URL-encoded page path'),
        stringParam('format', 'query', false, 'json (default) | text'),
      ],
      responses: jsonResponse('page record'),
    },
    put: {
      summary: 'Write a page and reindex it',
      tags: ['pages'],
      security: [{ adminToken: [] }],
      parameters: [stringParam('path', 'path', true)],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object', properties: { body: { type: 'string' } } } } },
      },
      responses: jsonResponse('ok with chunk count'),
    },
    delete: {
      summary: 'Delete a page',
      tags: ['pages'],
      security: [{ adminToken: [] }],
      parameters: [stringParam('path', 'path', true)],
      responses: jsonResponse('ok with chunks_removed count'),
    },
  },
  '/pages/move': {
    post: {
      summary: 'Move or rename a page',
      tags: ['pages'],
      security: [{ adminToken: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } } },
      },
      responses: jsonResponse('ok'),
    },
  },
  '/attrs': {
    get: {
      summary: 'List all frontmatter keys in use',
      tags: ['pages'],
      responses: jsonResponse('array of frontmatter keys'),
    },
  },
  '/pages/{path}/history': {
    get: {
      summary: 'List past versions of a page (newest first)',
      tags: ['pages'],
      security: [{ adminToken: [] }],
      parameters: [stringParam('path', 'path', true), intParam('limit', 'query', 'Default 10, cap 100')],
      responses: jsonResponse('entries[] with id, sha256, byte_size, written_at'),
    },
  },
  '/history/{id}': {
    get: {
      summary: 'Get a specific history entry (full body + frontmatter)',
      tags: ['pages'],
      security: [{ adminToken: [] }],
      parameters: [intParam('id', 'path', 'History entry id')],
      responses: jsonResponse('history entry'),
    },
  },

  // ─── Folders ───────────────────────────────────────────────────────────
  '/folders': {
    post: {
      summary: 'Create a folder',
      tags: ['folders'],
      security: [{ adminToken: [] }],
      responses: jsonResponse('ok'),
    },
  },
  '/folders/{path}': {
    delete: {
      summary: 'Delete a folder + all pages within',
      tags: ['folders'],
      security: [{ adminToken: [] }],
      parameters: [stringParam('path', 'path', true)],
      responses: jsonResponse('ok with pages_removed count'),
    },
  },
  '/folders/rename': {
    post: {
      summary: 'Rename a folder',
      tags: ['folders'],
      security: [{ adminToken: [] }],
      responses: jsonResponse('ok'),
    },
  },

  // ─── Index ─────────────────────────────────────────────────────────────
  '/index': {
    post: {
      summary: 'Trigger an incremental or full reindex',
      tags: ['index'],
      security: [{ adminToken: [] }],
      parameters: [stringParam('mode', 'query', false, 'incremental (default) | full')],
      responses: jsonResponse('files_indexed + chunks_added + duration_ms'),
    },
  },
  '/status': {
    get: {
      summary: 'Index state, page/chunk counts, model info',
      tags: ['index'],
      responses: jsonResponse('index status object'),
    },
  },

  // ─── Config ────────────────────────────────────────────────────────────
  '/config': {
    get: {
      summary: 'Get the active config (read-only view)',
      tags: ['config'],
      responses: jsonResponse('config object'),
    },
    put: {
      summary: 'Save new remember.config.ts source + hot-reload',
      tags: ['config'],
      security: [{ adminToken: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object', properties: { source: { type: 'string' } }, required: ['source'] } } },
      },
      responses: jsonResponse('ok with written_to, backup_path, restart_required, reloaded_at'),
    },
  },

  // ─── Observability ─────────────────────────────────────────────────────
  '/logs': {
    get: {
      summary: 'Recent operational events (last ~50, in-memory)',
      tags: ['observability'],
      security: [{ adminToken: [] }],
      parameters: [
        stringParam('level', 'query', false, 'error | warn | info | debug'),
        intParam('limit', 'query', 'Max entries to return (default 50, cap 200)'),
      ],
      responses: jsonResponse('entries[] + total'),
    },
  },
  '/events': {
    get: {
      summary: 'Server-Sent Events stream (live index + config events)',
      tags: ['observability'],
      security: [{ adminToken: [] }],
      responses: {
        [200]: { description: 'SSE stream', content: { 'text/event-stream': {} } },
      },
    },
  },

  // ─── Connectors ────────────────────────────────────────────────────────
  '/connectors': {
    get: {
      summary: 'List configured connectors + their last sync state',
      tags: ['connectors'],
      responses: jsonResponse('connectors[]'),
    },
  },
  '/connectors/{name}/sync': {
    post: {
      summary: 'Run a single connector now',
      tags: ['connectors'],
      security: [{ adminToken: [] }],
      parameters: [stringParam('name', 'path', true)],
      responses: jsonResponse('sync result'),
    },
  },
  '/connectors/sync': {
    post: {
      summary: 'Run every configured connector',
      tags: ['connectors'],
      security: [{ adminToken: [] }],
      responses: jsonResponse('per-connector result map'),
    },
  },
} as const;
