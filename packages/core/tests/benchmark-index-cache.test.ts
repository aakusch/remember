import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveIndexCache,
  type IndexCacheKey,
} from '../src/cli/commands/benchmark-cmd.js';

const KEY: IndexCacheKey = {
  corpus_hash: 'corpus-a',
  embedder_id: 'hash-embedder-384d',
  dim: 384,
  chunker_id: 'smart-split-900-0.15',
};

describe('benchmark index cache', () => {
  let cacheRoot: string;

  beforeEach(async () => {
    cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-index-cache-'));
  });

  afterEach(async () => {
    await fs.rm(cacheRoot, { recursive: true, force: true });
  });

  async function seedIndex(databasePath: string): Promise<void> {
    await fs.writeFile(databasePath, 'index-bytes');
  }

  it('misses on first use and reuses after a committed index', async () => {
    const first = await resolveIndexCache(cacheRoot, KEY);
    expect(first.reusable).toBe(false);

    await seedIndex(first.databasePath);
    await first.commit();

    const second = await resolveIndexCache(cacheRoot, KEY);
    expect(second.reusable).toBe(true);
    expect(second.databasePath).toBe(first.databasePath);
  });

  it('rebuilds when the corpus changes', async () => {
    const first = await resolveIndexCache(cacheRoot, KEY);
    await seedIndex(first.databasePath);
    await first.commit();

    const changed = await resolveIndexCache(cacheRoot, {
      ...KEY,
      corpus_hash: 'corpus-b',
    });
    expect(changed.reusable).toBe(false);
    expect(changed.databasePath).not.toBe(first.databasePath);
  });

  it('rebuilds when the embedder or chunker changes', async () => {
    const first = await resolveIndexCache(cacheRoot, KEY);
    await seedIndex(first.databasePath);
    await first.commit();

    const otherEmbedder = await resolveIndexCache(cacheRoot, {
      ...KEY,
      embedder_id: 'BAAI/bge-small-en-v1.5',
    });
    expect(otherEmbedder.reusable).toBe(false);

    const otherChunker = await resolveIndexCache(cacheRoot, {
      ...KEY,
      chunker_id: 'smart-split-500-0.1',
    });
    expect(otherChunker.reusable).toBe(false);
  });

  it('does not reuse an index from an interrupted run', async () => {
    const first = await resolveIndexCache(cacheRoot, KEY);
    // Index written but never committed, i.e. the run died mid-embedding. A
    // partial index must never be treated as a valid cache hit.
    await seedIndex(first.databasePath);

    const second = await resolveIndexCache(cacheRoot, KEY);
    expect(second.reusable).toBe(false);
  });

  it('clears a stale entry before rebuilding', async () => {
    const first = await resolveIndexCache(cacheRoot, KEY);
    await seedIndex(first.databasePath);

    const second = await resolveIndexCache(cacheRoot, KEY);
    await expect(fs.access(second.databasePath)).rejects.toThrow();
  });
});
