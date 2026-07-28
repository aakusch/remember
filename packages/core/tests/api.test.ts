import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHybridSearchEngine } from '../src/search/hybrid.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createPassthroughReranker } from '../src/rerankers/none.js';
import { createIndexer } from '../src/indexer/index.js';
import { createChokidarWalker } from '../src/walkers/chokidar.js';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';
import { createApp } from '../src/api/server.js';

describe('HTTP API (wired)', () => {
  let tmp: string;
  let store: SqliteVecStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-api-'));
    const contentRoot = path.join(tmp, 'content');
    await fs.mkdir(contentRoot);
    await fs.writeFile(
      path.join(contentRoot, 'welcome.md'),
      '---\ntitle: Welcome\n---\n\n# Welcome\n\nHello world. This is the wiki.',
    );

    const embedder = createHashEmbedder(384);
    store = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: embedder.dim });
    store.setDimension(embedder.dim);

    const indexer = createIndexer({
      walker: createChokidarWalker({}),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
    });
    await indexer.indexAll(contentRoot);

    const search = createHybridSearchEngine(store, embedder, createPassthroughReranker());
    const reindex = async () => {
      const r = await indexer.indexAll(contentRoot);
      return { files_indexed: r.files_indexed, chunks_added: r.chunks_added, duration_ms: r.duration_ms };
    };

    app = createApp({
      contentRoot,
      store,
      embedder,
      search,
      reindex,
      adminToken: null,
      remoteAllowed: false,
    });
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('GET /v1/health', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: '0.2.1' });
  });

  // 0.1.1 security: /v1/config must never return the raw adminToken value.
  it('GET /v1/config redacts the adminToken from the payload', async () => {
    const emb = createHashEmbedder(384);
    const secured = createApp({
      contentRoot: tmp,
      store,
      embedder: emb,
      search: createHybridSearchEngine(store, emb, createPassthroughReranker()),
      reindex: async () => ({ files_indexed: 0, chunks_added: 0, duration_ms: 0 }),
      adminToken: 'super-secret-token',
      boundHost: '127.0.0.1', // loopback → trusted-local read, the exposure case
      getConfig: () => ({
        content: tmp,
        server: { host: '127.0.0.1', port: 4321, apiPort: 4320, adminToken: 'super-secret-token' },
        viewer: { landing: 'README.md', showAdmin: true, breadcrumbs: true },
        schemaVersion: 1,
      }),
    });
    const res = await secured.request('/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: { server: { adminToken: string | null } } };
    expect(body.config.server.adminToken).not.toBe('super-secret-token');
    expect(JSON.stringify(body)).not.toContain('super-secret-token');
  });

  it('GET /v1/search returns results', async () => {
    const res = await app.request('/v1/search?q=welcome&k=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results.length).toBeGreaterThan(0);
  });

  it('GET /v1/search accepts intent/mode and maps debug to a structured trace', async () => {
    const res = await app.request(
      '/v1/search?q=welcome&intent=find%20the%20landing%20page&mode=fast&debug=1',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: unknown[];
      debug: {
        query: { normalized: string; intent?: string };
        planner: { id: string };
        timings: { candidate_retrieval_ms: number };
        ranking: unknown[];
      };
    };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.debug.query).toEqual({
      normalized: 'welcome',
      intent: 'find the landing page',
    });
    expect(body.debug.planner.id).toBe('passthrough-v1');
    expect(body.debug.timings.candidate_retrieval_ms).toEqual(expect.any(Number));
    expect(body.debug.ranking.length).toBeGreaterThan(0);
  });

  it('GET /v1/search rejects an unknown mode', async () => {
    const res = await app.request('/v1/search?q=welcome&mode=magic');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'INVALID_SEARCH_MODE',
        message: 'mode must be "fast" or "enhanced"',
      },
    });
  });

  it('GET /v1/pages lists wiki pages', async () => {
    const res = await app.request('/v1/pages');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pages: Array<{ path: string }> };
    expect(body.pages.find((p) => p.path === 'welcome.md')).toBeTruthy();
  });

  it('GET /v1/pages/<path> returns the page', async () => {
    const res = await app.request('/v1/pages/welcome.md');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { frontmatter: { title: string }; body: string };
    expect(body.frontmatter.title).toBe('Welcome');
    expect(body.body).toContain('Welcome');
  });

  it('GET /v1/pages/<path> rejects path traversal', async () => {
    const res = await app.request('/v1/pages/..%2Fevil.md');
    expect([400, 404]).toContain(res.status);
  });

  it('GET /v1/tools returns Anthropic-shaped tool defs', async () => {
    const res = await app.request('/v1/tools');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: Array<{ name: string; input_schema: unknown }> };
    const names = body.tools.map((t) => t.name);
    expect(names).toContain('search_wiki');
    expect(names).toContain('get_page');
    expect(names).toContain('list_pages');
  });

  it('GET /v1/status reports manifest stats', async () => {
    const res = await app.request('/v1/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { index: { page_count: number; model: string } };
    expect(body.index.page_count).toBeGreaterThanOrEqual(1);
    expect(body.index.model).toMatch(/hash|bge|text-embedding/);
  });

  it('GET /v1/openapi.json returns a spec stub', async () => {
    const res = await app.request('/v1/openapi.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toMatch(/^3\./);
    expect(Object.keys(body.paths).length).toBeGreaterThan(0);
  });
});
