import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';

describe('SqliteVecStore', () => {
  let tmp: string;
  let store: SqliteVecStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-store-'));
    store = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: 4 });
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('upserts + retrieves chunks via BM25 keyword search', async () => {
    await store.upsert([
      {
        id: 'a.md#0',
        source_path: 'a.md',
        chunk_idx: 0,
        text: 'the quick brown fox jumps over the lazy dog',
        heading_path: ['a'],
        embedding: [0.1, 0.2, 0.3, 0.4],
      },
      {
        id: 'b.md#0',
        source_path: 'b.md',
        chunk_idx: 0,
        text: 'lorem ipsum dolor sit amet consectetur',
        heading_path: ['b'],
        embedding: [0.5, 0.6, 0.7, 0.8],
      },
    ]);

    const hits = await store.searchBm25('fox', 5);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.path).toBe('a.md');
    expect(hits[0]!.heading_path).toEqual(['a']);
  });

  it('upserts + retrieves via vector cosine search', async () => {
    await store.upsert([
      {
        id: 'a.md#0',
        source_path: 'a.md',
        chunk_idx: 0,
        text: 'alpha',
        heading_path: [],
        embedding: [1, 0, 0, 0],
      },
      {
        id: 'b.md#0',
        source_path: 'b.md',
        chunk_idx: 0,
        text: 'beta',
        heading_path: [],
        embedding: [0, 1, 0, 0],
      },
    ]);

    const hits = await store.searchVector([1, 0, 0, 0], 5);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.path).toBe('a.md');
    expect(hits[0]!.heading_path).toEqual([]);
  });

  it('deleteByPath removes all chunks for a path', async () => {
    await store.upsert([
      { id: 'a.md#0', source_path: 'a.md', chunk_idx: 0, text: 'one', heading_path: [], embedding: [1, 0, 0, 0] },
      { id: 'a.md#1', source_path: 'a.md', chunk_idx: 1, text: 'two', heading_path: [], embedding: [0, 1, 0, 0] },
    ]);
    const removed = await store.deleteByPath('a.md');
    expect(removed).toBe(2);
    const after = await store.searchBm25('one', 5);
    expect(after).toEqual([]);
  });

  it('manifest round-trip', async () => {
    await store.updateManifest('x.md', { sha256: 'abc', chunk_count: 3, last_indexed: '2026-05-23T12:00:00Z' });
    const m = await store.getManifest();
    expect(m['x.md']).toEqual({ sha256: 'abc', chunk_count: 3, last_indexed: '2026-05-23T12:00:00Z' });
    await store.updateManifest('x.md', null);
    const m2 = await store.getManifest();
    expect(m2['x.md']).toBeUndefined();
  });

  it('returns full chunk text by id for reranking', async () => {
    await store.upsert([
      {
        id: 'a.md#0',
        source_path: 'a.md',
        chunk_idx: 0,
        text: 'full body of chunk a',
        heading_path: ['a'],
        embedding: [1, 0, 0, 0],
      },
      {
        id: 'b.md#0',
        source_path: 'b.md',
        chunk_idx: 0,
        text: 'full body of chunk b',
        heading_path: ['b'],
        embedding: [0, 1, 0, 0],
      },
    ]);

    const texts = await store.getChunkTexts(['a.md#0', 'b.md#0', 'missing#0']);

    expect(texts.get('a.md#0')).toBe('full body of chunk a');
    expect(texts.get('b.md#0')).toBe('full body of chunk b');
    expect(texts.has('missing#0')).toBe(false);
  });

  it('returns an empty map for no ids', async () => {
    expect((await store.getChunkTexts([])).size).toBe(0);
  });
});
