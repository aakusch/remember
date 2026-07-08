import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createIndexer } from '../src/indexer/index.js';
import { createChokidarWalker } from '../src/walkers/chokidar.js';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';

describe('indexer incremental correctness', () => {
  let tmp: string;
  let contentRoot: string;
  let store: SqliteVecStore;
  let indexer: ReturnType<typeof createIndexer>;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-incremental-'));
    contentRoot = path.join(tmp, 'content');
    await fs.mkdir(contentRoot);
    await fs.writeFile(path.join(contentRoot, 'a.md'), '# A\n\nAlpha content here.');
    await fs.writeFile(path.join(contentRoot, 'b.md'), '# B\n\nBeta content here.');
    await fs.writeFile(path.join(contentRoot, 'c.md'), '# C\n\nGamma content here.');

    const embedder = createHashEmbedder(384);
    store = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: embedder.dim });
    store.setDimension(embedder.dim);

    indexer = createIndexer({
      walker: createChokidarWalker({}),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
    });
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('skips unchanged files on re-run (sha256 short-circuit)', async () => {
    const first = await indexer.indexAll(contentRoot);
    expect(first.files_indexed).toBe(3);
    expect(first.files_skipped).toBe(0);
    expect(first.chunks_added).toBeGreaterThan(0);

    const second = await indexer.indexAll(contentRoot);
    expect(second.files_skipped).toBe(3);
    expect(second.files_indexed).toBe(0);
    expect(second.chunks_added).toBe(0);
    expect(second.files_deleted).toBe(0);
  });

  it('reindexes only the edited file, skipping the rest', async () => {
    await indexer.indexAll(contentRoot);
    await fs.writeFile(path.join(contentRoot, 'b.md'), '# B\n\nBeta content here — now edited and different.');

    const result = await indexer.indexAll(contentRoot);
    expect(result.files_indexed).toBe(1);
    expect(result.files_skipped).toBe(2);
    expect(result.files_deleted).toBe(0);
  });

  it('deletes orphaned files and removes their page + chunks', async () => {
    await indexer.indexAll(contentRoot);

    // Confirm c.md is indexed before deletion (manifest is deterministic;
    // BM25 tokenization is not, so we assert on the manifest here).
    const manifestBefore = await store.getManifest();
    expect(manifestBefore['c.md']).toBeDefined();
    const pagesBefore = await store.queryPages({ limit: 100, offset: 0 });
    expect(pagesBefore.rows.some((r) => r.path === 'c.md')).toBe(true);

    await fs.unlink(path.join(contentRoot, 'c.md'));
    const result = await indexer.indexAll(contentRoot);
    expect(result.files_deleted).toBe(1);
    expect(result.files_skipped).toBe(2);

    // Page record + chunks for c.md are gone.
    const manifestAfter = await store.getManifest();
    expect(manifestAfter['c.md']).toBeUndefined();

    const pagesAfter = await store.queryPages({ limit: 100, offset: 0 });
    expect(pagesAfter.rows.some((r) => r.path === 'c.md')).toBe(false);

    // And its chunks no longer surface in keyword search.
    const after = await store.searchBm25('gamma', 5);
    expect(after.some((h) => h.path === 'c.md')).toBe(false);
  });
});
