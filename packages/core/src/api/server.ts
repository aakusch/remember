import { Hono } from 'hono';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { registerRoutes, type RouteContext } from './routes.js';

export function createApp(ctx?: Partial<RouteContext>): Hono {
  const app = new Hono();

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
      saveConfig:
        ctx.saveConfig ??
        (async () => ({
          ok: false,
          error: {
            code: 'NO_SAVE_HANDLER',
            message: 'createApp was constructed without a saveConfig callback',
            hint: 'Use startServer() or pass ctx.saveConfig to createApp()',
          },
        })),
      reloadConfig: ctx.reloadConfig,
      logs: ctx.logs,
      history: ctx.history,
      events: ctx.events ?? new EventEmitter(),
      connectors:
        ctx.connectors ?? {
          list: () => [],
          syncOne: async () => ({ error: 'no connector manager' }),
          syncAll: async () => ({}),
        },
    });
  } else {
    registerScaffoldRoutes(app);
  }
  return app;
}

function registerScaffoldRoutes(app: Hono): void {
  app.get('/v1/health', (c) => c.json({ ok: true, version: '0.0.1' }));
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
    c.json({ openapi: '3.1.0', info: { title: 'remember (scaffold)', version: '0.0.1' }, paths: {} }),
  );
}
