import { Hono } from 'hono';
import { registerRoutes, type RouteContext } from './routes.js';

export function createApp(ctx?: Partial<RouteContext>): Hono {
  const app = new Hono();
  if (ctx && ctx.store && ctx.embedder && ctx.search && ctx.reindex && ctx.contentRoot) {
    registerRoutes(app, {
      contentRoot: ctx.contentRoot,
      store: ctx.store,
      embedder: ctx.embedder,
      search: ctx.search,
      reindex: ctx.reindex,
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
