import type { Hono } from 'hono';

const VERSION = '0.0.1';

const notImplemented = (endpoint: string) => ({
  error: {
    code: 'NOT_IMPLEMENTED',
    message: `${endpoint} not yet implemented in scaffold`,
    hint: 'See docs/superpowers/specs/ for the v1 design and roadmap',
  },
});

export function registerRoutes(app: Hono): void {
  app.get('/v1/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/v1/openapi.json', (c) =>
    c.json({
      openapi: '3.1.0',
      info: { title: 'remember', version: VERSION },
      paths: {},
    }),
  );

  // Search & retrieval — stubs
  app.get('/v1/search', (c) => c.json(notImplemented('GET /v1/search'), 501));
  app.get('/v1/pages', (c) => c.json(notImplemented('GET /v1/pages'), 501));
  app.get('/v1/pages/*', (c) => c.json(notImplemented('GET /v1/pages/<path>'), 501));

  // Mutations — stubs
  app.delete('/v1/pages/*', (c) => c.json(notImplemented('DELETE /v1/pages/<path>'), 501));
  app.post('/v1/pages/move', (c) => c.json(notImplemented('POST /v1/pages/move'), 501));
  app.post('/v1/folders', (c) => c.json(notImplemented('POST /v1/folders'), 501));
  app.delete('/v1/folders/*', (c) => c.json(notImplemented('DELETE /v1/folders/<path>'), 501));
  app.post('/v1/folders/rename', (c) => c.json(notImplemented('POST /v1/folders/rename'), 501));

  // Index lifecycle — stubs
  app.post('/v1/index', (c) => c.json(notImplemented('POST /v1/index'), 501));
  app.get('/v1/status', (c) => c.json(notImplemented('GET /v1/status'), 501));

  // Config — stubs
  app.get('/v1/config', (c) => c.json(notImplemented('GET /v1/config'), 501));
  app.put('/v1/config', (c) => c.json(notImplemented('PUT /v1/config'), 501));

  // Realtime — stub
  app.get('/v1/events', (c) => c.json(notImplemented('GET /v1/events'), 501));

  // AI tools surface — stub
  app.get('/v1/tools', (c) => c.json(notImplemented('GET /v1/tools'), 501));
}
