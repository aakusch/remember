import { Hono } from 'hono';
import { registerRoutes } from './routes.js';

export function createApp(): Hono {
  const app = new Hono();
  registerRoutes(app);
  return app;
}
