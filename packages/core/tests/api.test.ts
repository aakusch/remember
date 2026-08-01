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
import { VERSION } from '../src/version.js';
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

    const indexer = createIndexer({
      walker: createFsWalker({}),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
    });
    await indexer.indexAll(contentRoot);

    const search = createHybridSearchEngine(store, embedder, createNoneReranker());
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
    });
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('GET /v1/health', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: VERSION });
  });

  it('GET /v1/capabilities returns the discovery object', async () => {
    const res = await app.request('/v1/capabilities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Stable top-level keys — agents wire against these.
    expect(Object.keys(body)).toEqual([
      'version',
      'engine',
      'embedder',
      'endpoints',
      'commands',
      'json_schema_version',
    ]);
    expect(body.version).toBe(VERSION);
    expect(body.json_schema_version).toBe(1);
    // The API reports its live embedder (hash embedder in this harness).
    expect(body.embedder).toEqual({ model: 'hash-embedder-384d', dim: 384 });
    // /v1/capabilities lists itself among the endpoints.
    const paths = (body.endpoints as Array<{ path: string }>).map((e) => e.path);
    expect(paths).toContain('/v1/capabilities');
    expect(paths).toContain('/v1/search');
  });

  // 0.1.1 security: /v1/config must never return the raw adminToken value.
  it('GET /v1/config redacts the adminToken from the payload', async () => {
    const emb = createHashEmbedder(384);
    const secured = createApp({
      contentRoot: tmp,
      store,
      embedder: emb,
      search: createHybridSearchEngine(store, emb, createNoneReranker()),
      reindex: async () => ({ files_indexed: 0, chunks_added: 0, duration_ms: 0 }),
      adminToken: 'super-secret-token',
      boundHost: '127.0.0.1', // loopback → trusted-local read, the exposure case
      getConfig: () => ({
        content: tmp,
        server: { host: '127.0.0.1', apiPort: 4320, adminToken: 'super-secret-token' },
        schemaVersion: 1,
      }),
    });
    const res = await secured.request('/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: { server: { adminToken: string | null } } };
    expect(body.config.server.adminToken).not.toBe('super-secret-token');
    expect(JSON.stringify(body)).not.toContain('super-secret-token');
  });

  it('GET /v1/search returns results with the whitelisted field set', async () => {
    const res = await app.request('/v1/search?q=welcome&k=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<Record<string, unknown>> };
    expect(body.results.length).toBeGreaterThan(0);
    // The contract CLAUDE.md promises — exactly these keys, `title` present,
    // internal `chunk_idx` NOT leaked.
    expect(Object.keys(body.results[0]!).sort()).toEqual([
      'chunk_id',
      'frontmatter',
      'heading_path',
      'path',
      'retrievers',
      'score',
      'snippet',
      'title',
    ]);
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

  // Regression: `sort=modified` (an alias) crossed with a filter or q used to 500
  // because the COUNT query mis-sliced its params. Every sort alias × filter/q must 200.
  it('GET /v1/pages sort aliases crossed with a filter/q do not 500', async () => {
    for (const url of [
      '/v1/pages?sort=modified&filter[status]=current',
      '/v1/pages?sort=-modified&q=welcome',
      '/v1/pages?sort=size&filter[status]=current',
      '/v1/pages?sort=last_indexed&q=w',
    ]) {
      const res = await app.request(url);
      expect(res.status, url).toBe(200);
    }
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

  it('unknown route returns a structured JSON 404, not plain text', async () => {
    const res = await app.request('/v1/bogus');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { error: { code: string; message: string; hint?: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('/v1/bogus');
  });
});
