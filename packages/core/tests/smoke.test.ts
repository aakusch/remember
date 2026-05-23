import { describe, it, expect } from 'vitest';
import { defineConfig, createApp } from '../src/index.js';
import * as defaults from '../src/config/defaults.js';

describe('@remember/core scaffold', () => {
  it('defineConfig is identity', () => {
    const c = defineConfig({ name: 'test', content: './content' });
    expect(c.name).toBe('test');
    expect(c.content).toBe('./content');
  });

  it('default factories produce descriptor objects', () => {
    expect(defaults.embedder.localOnnx()).toMatchObject({
      _kind: 'embedder:localOnnx',
      opts: { model: 'BAAI/bge-small-en-v1.5' },
    });
    expect(defaults.chunker.smartSplit()).toMatchObject({
      _kind: 'chunker:smartSplit',
      opts: { size: 900, overlap: 0.15 },
    });
    expect(defaults.store.sqliteVec()).toMatchObject({
      _kind: 'store:sqliteVec',
      opts: { path: '.remember/index.db' },
    });
    expect(defaults.search.hybrid()).toMatchObject({
      _kind: 'search:hybrid',
      opts: { fusion: 'rrf', topK: 20, finalK: 10 },
    });
  });

  it('Hono app responds 200 to /v1/health', async () => {
    const app = createApp();
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: '0.0.1' });
  });

  it('search returns 501 with NOT_IMPLEMENTED in scaffold', async () => {
    const app = createApp();
    const res = await app.request('/v1/search?q=test');
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('tools endpoint returns 501 in scaffold', async () => {
    const app = createApp();
    const res = await app.request('/v1/tools');
    expect(res.status).toBe(501);
  });
});
