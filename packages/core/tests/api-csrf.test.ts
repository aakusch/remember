import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHybridSearchEngine } from '../src/search/hybrid.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createNoneReranker } from '../src/rerankers/none.js';
import { createIndexer } from '../src/indexer/index.js';
import { createFsWalker } from '../src/walkers/fs-walker.js';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';
import { createApp } from '../src/api/server.js';
import type { Hono } from 'hono';

describe('API CSRF + input validation (loopback, no token)', () => {
  let tmp: string;
  let store: SqliteVecStore;
  let app: Hono;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-csrf-'));
    const contentRoot = path.join(tmp, 'content');
    await fs.mkdir(contentRoot);
    await fs.writeFile(path.join(contentRoot, 'a.md'), '# A\n\nAlpha body text here.');
    const embedder = createHashEmbedder(384);
    store = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: embedder.dim });
    const indexer = createIndexer({
      walker: createFsWalker({}),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
    });
    await indexer.indexAll(contentRoot);
    app = createApp({
      contentRoot,
      store,
      embedder,
      search: createHybridSearchEngine(store, embedder, createNoneReranker()),
      reindex: async () => ({ files_indexed: 0, chunks_added: 0, duration_ms: 0 }),
      adminToken: null,
      boundHost: '127.0.0.1',
    });
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('rejects a non-numeric k with 400 (not a 500 crash)', async () => {
    const res = await app.request('/v1/search?q=alpha&k=abc');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_PARAM');
  });

  it('rejects an over-long query with 400', async () => {
    const res = await app.request(`/v1/search?q=${'x'.repeat(3000)}`);
    expect(res.status).toBe(400);
  });

  it('blocks a cross-origin write (Origin not loopback) with 403', async () => {
    const res = await app.request('/v1/index', {
      method: 'POST',
      headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('blocks a Sec-Fetch-Site: cross-site write with 403', async () => {
    const res = await app.request('/v1/index', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('blocks a no-preflight simple POST (non-JSON content-type) with 415', async () => {
    const res = await app.request('/v1/index', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('allows a same-origin JSON write on a loopback bind', async () => {
    const res = await app.request('/v1/index', {
      method: 'POST',
      headers: { origin: 'http://localhost:4320', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
  });

  it('blocks a rebound non-loopback Host with 403', async () => {
    const res = await app.request('/v1/pages', { headers: { host: 'evil.example.com' } });
    expect(res.status).toBe(403);
  });

  it('has NO PUT /v1/config (the config-write RCE endpoint is removed)', async () => {
    const res = await app.request('/v1/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'export default {}' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an empty Content-Type on POST/PUT (no-preflight hole) with 415', async () => {
    const res = await app.request('/v1/index', { method: 'POST', headers: { 'content-type': '' }, body: '{}' });
    expect(res.status).toBe(415);
  });

  it('rejects a NUL-byte page path with 400, not a 500', async () => {
    const res = await app.request('/v1/pages/ok%00.md', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});
