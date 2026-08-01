import { Hono } from 'hono';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { registerRoutes, type RouteContext } from './routes.js';
import { VERSION } from '../version.js';

export function createApp(ctx?: Partial<RouteContext>): Hono {
  const app = new Hono();

  // Unknown route → structured JSON, matching every other error on the API.
  // Why: the default Hono 404 is plain-text "404 Not Found", which an agent
  // parsing `error.code` off the body chokes on. Keep the whole surface JSON.
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `No route for ${c.req.method} ${new URL(c.req.url).pathname}`,
          hint: 'GET /v1/capabilities lists every available endpoint.',
        },
      },
      404,
    ),
  );

  // Global error handler — captures any uncaught route exception into the
  // log buffer so the Diagnostics page can show "what just broke" without
  // requiring the user to dig through stdout.
  app.onError((err, c) => {
    // Correlation id ties the client-facing 500 to the detailed server-side log
    // entry. Why: err.message can leak absolute fs paths / sqlite internals;
    // only client-safe error codes (thrown with their own response upstream)
    // should surface detail. Generic 500s stay opaque to the client.
    const correlationId = randomUUID();
    if (ctx?.logs) {
      ctx.logs.push({
        level: 'error',
        source: 'http',
        message: `[${correlationId}] ${c.req.method} ${new URL(c.req.url).pathname}: ${err.message}`,
        detail: { stack: err.stack?.split('\n').slice(0, 3).join(' | ') },
      });
    }
    return c.json(
      { error: { code: 'INTERNAL', message: 'internal error', correlation_id: correlationId } },
      500,
    );
  });

  if (ctx && ctx.store && ctx.embedder && ctx.search && ctx.reindex && ctx.contentRoot) {
    registerRoutes(app, {
      contentRoot: ctx.contentRoot,
      store: ctx.store,
      embedder: ctx.embedder,
      search: ctx.search,
      reindex: ctx.reindex,
      reindexOne:
        ctx.reindexOne ??
        (async () => ({ chunks_added: 0 })),
      adminToken: ctx.adminToken ?? null,
      // Authoritative bind host for local-trust decisions. Defaults to loopback
      // so unconfigured test apps keep the zero-config open-reads behavior.
      boundHost: ctx.boundHost ?? '127.0.0.1',
      remoteAllowed: ctx.remoteAllowed ?? false,
      configPath: ctx.configPath ?? null,
      configRoot: ctx.configRoot ?? ctx.contentRoot,
      getConfig:
        ctx.getConfig ??
        (() => ({
          content: ctx.contentRoot!,
          server: { host: '127.0.0.1', port: 4321, apiPort: 4320, adminToken: null },
          viewer: { landing: 'README.md', showAdmin: true, breadcrumbs: true },
          schemaVersion: 1,
        })),
      logs: ctx.logs,
      history: ctx.history,
      events: ctx.events ?? new EventEmitter(),
    });
  } else {
    registerScaffoldRoutes(app);
  }
  return app;
}

function registerScaffoldRoutes(app: Hono): void {
  app.get('/v1/health', (c) => c.json({ ok: true, version: VERSION }));
  const ni = (endpoint: string) => ({
    error: {
      code: 'NOT_IMPLEMENTED' as const,
      message: `${endpoint} requires a runtime context (store, embedder, search, reindex, contentRoot)`,
      hint: 'createApp(ctx) with a fully wired context, or use the CLI: `remember start`',
    },
  });
  app.get('/v1/search', (c) => c.json(ni('GET /v1/search'), 501));
  app.get('/v1/pages', (c) => c.json(ni('GET /v1/pages'), 501));
  app.get('/v1/status', (c) => c.json(ni('GET /v1/status'), 501));
  app.get('/v1/tools', (c) => c.json(ni('GET /v1/tools'), 501));
  app.get('/v1/openapi.json', (c) =>
    c.json({ openapi: '3.1.0', info: { title: 'remember (scaffold)', version: VERSION }, paths: {} }),
  );
}
