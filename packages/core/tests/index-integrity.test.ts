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

let tmp: string;
let store: SqliteVecStore;

async function mkStore(): Promise<SqliteVecStore> {
  return createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: 384 });
}

function mkIndexer(s: SqliteVecStore) {
  return createIndexer({
    walker: createChokidarWalker({}),
    parser: createRemarkParser(),
    chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
    embedder: createHashEmbedder(384),
    store: s,
  });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-integrity-'));
});
afterEach(async () => {
  try {
    store.close();
  } catch {
    /* already closed */
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('reconcileEmbedder — vector-loss prevention', () => {
  it('is a no-op when the embedder identity is unchanged', async () => {
    store = await mkStore();
    expect(store.reconcileEmbedder('bge-384', 384)).toEqual({ changed: false, previousModelId: null });
    // Second open with the SAME identity must not clear anything.
    expect(store.reconcileEmbedder('bge-384', 384)).toEqual({ changed: false, previousModelId: 'bge-384' });
  });

  it('clears the manifest when the MODEL changes at the same dimension', async () => {
    const content = path.join(tmp, 'content');
    await fs.mkdir(content);
    await fs.writeFile(path.join(content, 'a.md'), '# A\n\nAlpha content.');
    store = await mkStore();
    store.reconcileEmbedder('model-a', 384);
    const first = await mkIndexer(store).indexAll(content);
    expect(first.files_indexed).toBe(1);
    expect(Object.keys(await store.getManifest())).toHaveLength(1);

    // Same dimension, different model — this is the case that used to silently mix
    // garbage vectors. It must clear the manifest so the next index re-embeds.
    const rec = store.reconcileEmbedder('model-b', 384);
    expect(rec).toEqual({ changed: true, previousModelId: 'model-a' });
    expect(Object.keys(await store.getManifest())).toHaveLength(0);

    const second = await mkIndexer(store).indexAll(content);
    expect(second.files_indexed).toBe(1); // re-embedded, not reported "unchanged"
  });

  it('clears everything when the DIMENSION changes', async () => {
    const content = path.join(tmp, 'content');
    await fs.mkdir(content);
    await fs.writeFile(path.join(content, 'a.md'), '# A\n\nAlpha content.');
    store = await mkStore();
    store.reconcileEmbedder('bge-384', 384);
    await mkIndexer(store).indexAll(content);

    const rec = store.reconcileEmbedder('openai-1536', 1536);
    expect(rec.changed).toBe(true);
    expect(Object.keys(await store.getManifest())).toHaveLength(0);
  });
});

describe('indexAll — one bad file must not abort the run', () => {
  it('skips a malformed-frontmatter file, records it, and indexes the rest', async () => {
    const content = path.join(tmp, 'content');
    await fs.mkdir(content);
    await fs.writeFile(path.join(content, 'aaa-good.md'), '# Good A\n\nAlpha.');
    // Unterminated YAML flow sequence — gray-matter throws on this.
    await fs.writeFile(path.join(content, 'bbb-bad.md'), '---\ntags: [a, b\n---\n\n# Bad\n\nBody.');
    await fs.writeFile(path.join(content, 'zzz-good.md'), '# Good Z\n\nOmega.');

    store = await mkStore();
    store.reconcileEmbedder('bge-384', 384);
    const result = await mkIndexer(store).indexAll(content);

    // The two good files index; the bad one is isolated, not fatal.
    expect(result.files_indexed).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.path).toContain('bbb-bad.md');
  });
});
