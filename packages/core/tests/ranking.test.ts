import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collapsePerPage, applyHeadingBoost, createHybridSearchEngine } from '../src/search/hybrid.js';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createPassthroughReranker } from '../src/rerankers/none.js';
import type { SearchResult } from '../src/types.js';

function hit(p: string, score: number, heading_path?: string[], chunk_idx = 0): SearchResult {
  return {
    path: p,
    chunk_idx,
    snippet: '',
    frontmatter: {},
    score,
    retrievers: ['bm25'],
    chunk_id: `${p}#${chunk_idx}`,
    ...(heading_path ? { heading_path } : {}),
  };
}

describe('collapsePerPage', () => {
  it('keeps only the first (highest-scoring) chunk per path', () => {
    const hits = [
      hit('a.md', 0.9, undefined, 0),
      hit('a.md', 0.5, undefined, 1),
      hit('b.md', 0.4, undefined, 0),
      hit('a.md', 0.3, undefined, 2),
    ];
    const out = collapsePerPage(hits);
    expect(out.map((h) => h.path)).toEqual(['a.md', 'b.md']);
    // The retained a.md chunk is the first-seen (highest-scoring) one.
    expect(out[0]!.chunk_id).toBe('a.md#0');
    expect(out[0]!.score).toBe(0.9);
  });

  it('preserves input order (already score-sorted)', () => {
    const hits = [hit('x.md', 0.8), hit('y.md', 0.7), hit('z.md', 0.6)];
    const out = collapsePerPage(hits);
    expect(out.map((h) => h.path)).toEqual(['x.md', 'y.md', 'z.md']);
  });

  it('returns an empty array for empty input', () => {
    expect(collapsePerPage([])).toEqual([]);
  });
});

describe('applyHeadingBoost', () => {
  it('returns hits unchanged when factor is 0', () => {
    const hits = [hit('a.md', 0.5, ['Authentication', 'OAuth flow'])];
    expect(applyHeadingBoost(hits, 'oauth flow', 0)).toEqual(hits);
  });

  it('returns hits unchanged when query has no content tokens', () => {
    const hits = [hit('a.md', 0.5, ['OAuth flow'])];
    expect(applyHeadingBoost(hits, 'the and is', 1)).toEqual(hits);
  });

  it('scales the score by the fraction of matched heading tokens and re-sorts', () => {
    const full = hit('a.md', 0.1, ['Authentication', 'OAuth flow']); // both terms
    const partial = hit('b.md', 0.1, ['OAuth notes']); // one term
    const out = applyHeadingBoost([partial, full], 'oauth flow', 1);
    // full: 1 + (2/2)*1 = 2x -> 0.2 ; partial: 1 + (1/2)*1 = 1.5x -> 0.15
    expect(out[0]!.path).toBe('a.md');
    expect(out[0]!.score).toBeCloseTo(0.2, 5);
    expect(out[1]!.score).toBeCloseTo(0.15, 5);
  });

  it('leaves hits without a matching heading untouched', () => {
    const out = applyHeadingBoost([hit('a.md', 0.5, ['Misc Notes'])], 'oauth flow', 1);
    expect(out[0]!.score).toBe(0.5);
  });

  it('handles hits with no heading_path', () => {
    const out = applyHeadingBoost([hit('a.md', 0.5)], 'oauth flow', 1);
    expect(out[0]!.score).toBe(0.5);
  });
});

describe('hybrid engine ranking pipeline (engine-level)', () => {
  let tmp: string;
  let store: SqliteVecStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-ranking-'));
    const embedder = createHashEmbedder(384);
    store = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: embedder.dim });
    store.setDimension(embedder.dim);
  });

  afterEach(async () => {
    store.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('dedupByPage collapses multiple chunks of one page to a single result', async () => {
    const embedder = createHashEmbedder(384);
    // One page with three chunks that all mention "deployment".
    await store.upsert([
      { id: 'long.md#0', source_path: 'long.md', chunk_idx: 0, text: 'deployment runbook step one deployment', heading_path: ['Deploy'], embedding: (await embedder.embed(['deployment one']))[0]! },
      { id: 'long.md#1', source_path: 'long.md', chunk_idx: 1, text: 'deployment runbook step two deployment', heading_path: ['Deploy'], embedding: (await embedder.embed(['deployment two']))[0]! },
      { id: 'long.md#2', source_path: 'long.md', chunk_idx: 2, text: 'deployment runbook step three deployment', heading_path: ['Deploy'], embedding: (await embedder.embed(['deployment three']))[0]! },
      { id: 'other.md#0', source_path: 'other.md', chunk_idx: 0, text: 'unrelated glossary of terms', heading_path: [], embedding: (await embedder.embed(['glossary']))[0]! },
    ]);

    const engine = createHybridSearchEngine(store, embedder, createPassthroughReranker(), { dedupByPage: true });
    const res = await engine.query('deployment', { k: 10 });
    const longHits = res.results.filter((r) => r.path === 'long.md');
    expect(longHits.length).toBe(1);
  });

  it('without dedup, multiple chunks of the same page can appear', async () => {
    const embedder = createHashEmbedder(384);
    await store.upsert([
      { id: 'long.md#0', source_path: 'long.md', chunk_idx: 0, text: 'deployment runbook step one deployment', heading_path: [], embedding: (await embedder.embed(['deployment one']))[0]! },
      { id: 'long.md#1', source_path: 'long.md', chunk_idx: 1, text: 'deployment runbook step two deployment', heading_path: [], embedding: (await embedder.embed(['deployment two']))[0]! },
    ]);
    const engine = createHybridSearchEngine(store, embedder, createPassthroughReranker(), { dedupByPage: false });
    const res = await engine.query('deployment', { k: 10 });
    const longHits = res.results.filter((r) => r.path === 'long.md');
    expect(longHits.length).toBeGreaterThan(1);
  });

  it('path boost promotes the canonical page whose path contains the query terms', async () => {
    const embedder = createHashEmbedder(384);
    // Both mention "vietnam war"; only one has it in the path.
    await store.upsert([
      { id: 'history/vietnam-war.md#0', source_path: 'history/vietnam-war.md', chunk_idx: 0, text: 'the vietnam war was a conflict', heading_path: [], embedding: (await embedder.embed(['vietnam war canonical']))[0]! },
      { id: 'notes/misc.md#0', source_path: 'notes/misc.md', chunk_idx: 0, text: 'a passing mention of the vietnam war among many topics', heading_path: [], embedding: (await embedder.embed(['misc notes vietnam']))[0]! },
    ]);
    const engine = createHybridSearchEngine(store, embedder, createPassthroughReranker(), { pathBoostFactor: 2 });
    const res = await engine.query('vietnam war', { k: 10 });
    expect(res.results[0]!.path).toBe('history/vietnam-war.md');
  });
});
