import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { breakLexicalTies, createHybridSearchEngine } from '../src/search/hybrid.js';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createPassthroughReranker } from '../src/rerankers/none.js';
import { createIndexer } from '../src/indexer/index.js';
import { createChokidarWalker } from '../src/walkers/chokidar.js';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';
import type { SearchResult } from '../src/types.js';

function hit(id: string, score: number, snippet: string): SearchResult {
  return {
    path: `${id}.md`,
    chunk_idx: 0,
    snippet,
    frontmatter: {},
    score,
    retrievers: ['bm25'],
    chunk_id: `${id}#0`,
  };
}

describe('breakLexicalTies (pure)', () => {
  it('is a no-op when there are no query terms', () => {
    const hits = [hit('a', 0.5, 'alpha'), hit('b', 0.5, 'beta')];
    expect(breakLexicalTies(hits, 'the and is')).toEqual(hits);
  });

  it('leaves the array untouched when no scores are tied', () => {
    const hits = [hit('a', 0.9, 'nothing'), hit('b', 0.5, 'deploy deploy deploy')];
    // b has more lexical overlap but a higher-scoring result must not move.
    expect(breakLexicalTies(hits, 'deploy')).toEqual(hits);
  });

  it('reorders an exact-score tie by distinct-term overlap', () => {
    const low = hit('low', 0.3, 'talks about deploy only');
    const high = hit('high', 0.3, 'deploy runbook rollback steps');
    const out = breakLexicalTies([low, high], 'deploy rollback runbook');
    expect(out.map((h) => h.chunk_id)).toEqual(['high#0', 'low#0']);
  });

  it('uses term frequency as the secondary key when overlap ties', () => {
    const once = hit('once', 0.3, 'deploy the thing');
    const twice = hit('twice', 0.3, 'deploy then deploy again');
    const out = breakLexicalTies([once, twice], 'deploy');
    expect(out.map((h) => h.chunk_id)).toEqual(['twice#0', 'once#0']);
  });

  it('is stable: equal density keeps original order', () => {
    const first = hit('first', 0.3, 'deploy');
    const second = hit('second', 0.3, 'deploy');
    const out = breakLexicalTies([first, second], 'deploy');
    expect(out.map((h) => h.chunk_id)).toEqual(['first#0', 'second#0']);
  });

  it('only reorders within a tie group, never across score boundaries', () => {
    const hits = [
      hit('a', 0.5, 'no match'),
      hit('b', 0.5, 'deploy deploy'),
      hit('c', 0.4, 'deploy'),
    ];
    const out = breakLexicalTies(hits, 'deploy');
    // The 0.5 group swaps (b outranks a); c stays last because its score is lower.
    expect(out.map((h) => h.chunk_id)).toEqual(['b#0', 'a#0', 'c#0']);
  });
});

describe('lexicalTieBreak flag (engine)', () => {
  let tmp: string;
  let store: SqliteVecStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-tiebreak-'));
    const contentRoot = path.join(tmp, 'content');
    await fs.mkdir(contentRoot);
    // A few docs so fusion produces a non-trivial ranking.
    await fs.writeFile(path.join(contentRoot, 'deploy.md'), '# Deploy\n\nDeploy runbook for production releases.');
    await fs.writeFile(path.join(contentRoot, 'rollback.md'), '# Rollback\n\nRollback and fix-forward guidance.');
    await fs.writeFile(path.join(contentRoot, 'onboarding.md'), '# Onboarding\n\nNew hire onboarding checklist.');
    await fs.writeFile(path.join(contentRoot, 'glossary.md'), '# Glossary\n\nTerms and definitions.');

    const embedder = createHashEmbedder(384);
    store = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: embedder.dim });
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

  it('flag OFF equals the default engine, result-for-result', async () => {
    const embedder = createHashEmbedder(384);
    const queries = ['deploy runbook', 'rollback', 'onboarding checklist', 'glossary terms', 'production'];
    const baseline = createHybridSearchEngine(store, embedder, createPassthroughReranker());
    const explicitOff = createHybridSearchEngine(store, embedder, createPassthroughReranker(), {
      lexicalTieBreak: false,
    });
    for (const q of queries) {
      const a = await baseline.query(q, { k: 10 });
      const b = await explicitOff.query(q, { k: 10 });
      expect(b.results.map((r) => r.chunk_id)).toEqual(a.results.map((r) => r.chunk_id));
      expect(b.results.map((r) => r.score)).toEqual(a.results.map((r) => r.score));
    }
  });

  it('flag ON never drops or duplicates any result versus OFF (tie-only reordering)', async () => {
    const embedder = createHashEmbedder(384);
    const queries = ['deploy runbook', 'rollback', 'onboarding checklist', 'glossary terms', 'production'];
    const off = createHybridSearchEngine(store, embedder, createPassthroughReranker());
    const on = createHybridSearchEngine(store, embedder, createPassthroughReranker(), {
      lexicalTieBreak: true,
    });
    for (const q of queries) {
      const a = await off.query(q, { k: 10 });
      const b = await on.query(q, { k: 10 });
      // Same set of results (tie-break only permutes, never adds/removes).
      expect(new Set(b.results.map((r) => r.chunk_id))).toEqual(
        new Set(a.results.map((r) => r.chunk_id)),
      );
    }
  });
});
