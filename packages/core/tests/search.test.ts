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

describe('end-to-end hybrid search', () => {
  let tmp: string;
  let store: SqliteVecStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-search-'));
    await fs.mkdir(path.join(tmp, 'content'));
    await fs.writeFile(
      path.join(tmp, 'content', 'a.md'),
      '---\ntitle: Onboarding\n---\n\n# Client onboarding\n\nSteps to onboard a new client.',
    );
    await fs.writeFile(
      path.join(tmp, 'content', 'b.md'),
      '---\ntitle: Glossary\n---\n\n# Glossary\n\nAcronyms and definitions for the team.',
    );
    await fs.writeFile(
      path.join(tmp, 'content', 'c.md'),
      '---\ntitle: Deploy runbook\n---\n\n# Deploy runbook\n\nHow to push to production safely.',
    );

    const embedder = createHashEmbedder(384);
    store = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: embedder.dim });

    const indexer = createIndexer({
      walker: createChokidarWalker({}),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
    });

    await indexer.indexAll(path.join(tmp, 'content'));
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('BM25 keyword search hits the onboarding page', async () => {
    const embedder = createHashEmbedder(384);
    const engine = createHybridSearchEngine(store, embedder, createPassthroughReranker());
    const res = await engine.query('onboard', { k: 5 });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0]!.path).toBe('a.md');
  });

  it('returns the expected shape', async () => {
    const embedder = createHashEmbedder(384);
    const engine = createHybridSearchEngine(store, embedder, createPassthroughReranker());
    const res = await engine.query('runbook', { k: 5, debug: true });
    expect(res).toHaveProperty('results');
    expect(res).toHaveProperty('query_ms');
    expect(res.debug).toBeTruthy();
    const top = res.results[0];
    if (top) {
      expect(top).toHaveProperty('path');
      expect(top).toHaveProperty('chunk_id');
      expect(top).toHaveProperty('snippet');
      expect(top).toHaveProperty('score');
      expect(Array.isArray(top.retrievers)).toBe(true);
    }
  });
});
