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

const ADMIN_TOKEN = 'super-secret-admin-token';

/**
 * Regression tests for the Host-header read-auth bypass.
 *
 * The trust decision must derive from the REAL connection (bound host +
 * actual peer address), never from the client-supplied Host /
 * X-Forwarded-Host header. A remote attacker sending `Host: localhost`
 * to a 0.0.0.0-bound server with an adminToken must NOT be granted reads.
 */
describe('read-auth trust derives from connection, not Host header', () => {
  let tmp: string;
  let store: SqliteVecStore;
  let contentRoot: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-readauth-'));
    contentRoot = path.join(tmp, 'content');
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
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function buildApp(opts: { host: string; adminToken: string | null }) {
    const embedder = createHashEmbedder(384);
    const search = createHybridSearchEngine(store, embedder, createPassthroughReranker());
    const reindex = async () => ({ files_indexed: 0, chunks_added: 0, duration_ms: 0 });
    return createApp({
      contentRoot,
      store,
      embedder,
      search,
      reindex,
      adminToken: opts.adminToken,
      boundHost: opts.host,
      remoteAllowed: opts.host !== '127.0.0.1',
      getConfig: () => ({
        content: contentRoot,
        server: { host: opts.host, port: 4321, apiPort: 4320, adminToken: opts.adminToken },
        viewer: { landing: 'README.md', showAdmin: true, breadcrumbs: true },
        schemaVersion: 1,
      }),
    });
  }

  // Simulate the @hono/node-server binding: c.env.incoming.socket exposes the
  // real TCP peer. A remote attacker connects from a public IP.
  const remoteEnv = (remoteAddress: string, remoteFamily = 'IPv4') => ({
    incoming: { socket: { remoteAddress, remoteFamily } },
  });

  it('(1) rejects a spoofed Host: localhost read on a non-loopback bind with a token set', async () => {
    const app = buildApp({ host: '0.0.0.0', adminToken: ADMIN_TOKEN });

    const search = await app.request(
      '/v1/search?q=welcome',
      { headers: { host: 'localhost', 'x-forwarded-host': 'localhost' } },
      remoteEnv('203.0.113.7'),
    );
    expect(search.status).toBe(401);

    // The crown-jewel leak: /v1/config must NOT be served to the attacker.
    const config = await app.request(
      '/v1/config',
      { headers: { host: '127.0.0.1', 'x-forwarded-host': '127.0.0.1' } },
      remoteEnv('203.0.113.7'),
    );
    expect(config.status).toBe(401);
    const body = (await config.json()) as { config?: { server?: { adminToken?: string } } };
    expect(body.config).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(ADMIN_TOKEN);
  });

  it('(2) loopback bind + no token: reads succeed (dev UX preserved)', async () => {
    const app = buildApp({ host: '127.0.0.1', adminToken: null });

    const search = await app.request('/v1/search?q=welcome');
    expect(search.status).toBe(200);

    const config = await app.request('/v1/config');
    expect(config.status).toBe(200);
  });

  it('(3) non-loopback bind + token + correct Bearer: reads succeed', async () => {
    const app = buildApp({ host: '0.0.0.0', adminToken: ADMIN_TOKEN });

    const search = await app.request(
      '/v1/search?q=welcome',
      { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
      remoteEnv('203.0.113.7'),
    );
    expect(search.status).toBe(200);

    const config = await app.request(
      '/v1/config',
      { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
      remoteEnv('203.0.113.7'),
    );
    expect(config.status).toBe(200);
  });

  it('non-loopback bind + token + actual loopback peer: local-trust granted (no header involved)', async () => {
    const app = buildApp({ host: '0.0.0.0', adminToken: ADMIN_TOKEN });

    // A genuine local request lands with a loopback remoteAddress even when the
    // server is bound to 0.0.0.0. Trust is granted from the peer, not a header.
    const search = await app.request(
      '/v1/search?q=welcome',
      { headers: { host: 'attacker.example.com' } },
      remoteEnv('127.0.0.1'),
    );
    expect(search.status).toBe(200);
  });

  it('non-loopback bind + token + no peer info available: read requires Bearer', async () => {
    const app = buildApp({ host: '0.0.0.0', adminToken: ADMIN_TOKEN });

    // No env.incoming (peer address unknown) and no token => must be rejected.
    const search = await app.request('/v1/search?q=welcome', {
      headers: { host: 'localhost' },
    });
    expect(search.status).toBe(401);
  });

  it('loopback bind + token set: localhost reads stay open (header not consulted for trust)', async () => {
    // When bound to loopback, the OS only routes loopback traffic here, so
    // open reads are safe regardless of the Host header value.
    const app = buildApp({ host: '127.0.0.1', adminToken: ADMIN_TOKEN });
    const res = await app.request('/v1/search?q=welcome', { headers: { host: 'whatever' } });
    expect(res.status).toBe(200);
  });
});
