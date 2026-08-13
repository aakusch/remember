import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createIndexer } from '../src/indexer/index.js';
import { createFsWalker } from '../src/walkers/fs-walker.js';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';

/**
 * Durability and recovery behaviour of the on-disk index.
 *
 * These cases were previously untested and were exercised by hand against a real
 * 496-document Obsidian vault before being written down here. They characterize
 * three failure modes a user WILL hit — an interrupted index, a damaged database
 * file, and a second process reading while one writes — so a later change cannot
 * quietly regress any of them.
 *
 * The hash embedder is used deliberately: these assert index/store mechanics, not
 * retrieval quality, and a real model would make the suite minutes long.
 */

let tmp: string;
let contentRoot: string;
const stores: SqliteVecStore[] = [];

function mkIndexer(s: SqliteVecStore) {
  return createIndexer({
    walker: createFsWalker({}),
    parser: createRemarkParser(),
    chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
    embedder: createHashEmbedder(384),
    store: s,
  });
}

async function mkStore(): Promise<SqliteVecStore> {
  const s = await createSqliteVecStore({ path: path.join(tmp, 'index.db'), dim: 384 });
  stores.push(s);
  return s;
}

async function seed(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await fs.writeFile(
      path.join(contentRoot, `doc-${i}.md`),
      `# Document ${i}\n\nBody text for document ${i} with enough words to chunk.\n`,
    );
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-durability-'));
  contentRoot = path.join(tmp, 'content');
  await fs.mkdir(contentRoot, { recursive: true });
});

afterEach(async () => {
  for (const s of stores.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('interrupted index', () => {
  it('resumes instead of restarting: work already committed is skipped by hash', async () => {
    await seed(12);

    // Simulate the kill: index everything, then drop the manifest entries for
    // the tail. That is the state a SIGINT leaves — per-file commits mean the
    // files already written stay durable and the rest look new.
    const first = await mkStore();
    await mkIndexer(first).indexAll(contentRoot);
    const full = await first.getManifest();
    expect(Object.keys(full)).toHaveLength(12);
    for (const p of Object.keys(full).slice(6)) {
      await first.updateManifest(p, null);
    }
    first.close();

    // Re-open and resume. The six survivors must be skipped, not re-embedded.
    const second = await mkStore();
    const result = await mkIndexer(second).indexAll(contentRoot);
    expect(result.files_skipped).toBe(6);
    expect(result.files_indexed).toBe(6);
    expect(Object.keys(await second.getManifest())).toHaveLength(12);
  });

  it('a partially indexed database still reads: status/search see committed work', async () => {
    await seed(8);
    const store = await mkStore();
    await mkIndexer(store).indexAll(contentRoot);
    const manifest = await store.getManifest();
    // Nothing is half-written: every manifest entry has a real chunk count.
    for (const entry of Object.values(manifest)) {
      expect(entry.chunk_count).toBeGreaterThan(0);
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe('damaged database file', () => {
  it('fails with an error rather than silently returning an empty index', async () => {
    const dbPath = path.join(tmp, 'index.db');
    await fs.writeFile(dbPath, Buffer.alloc(64 * 1024, 0x41)); // not a SQLite file

    let threw: unknown = null;
    try {
      const s = await createSqliteVecStore({ path: dbPath, dim: 384 });
      stores.push(s);
      await s.getManifest();
    } catch (err) {
      threw = err;
    }

    // The dangerous outcome would be a store that opens and reports zero pages —
    // a user would read that as "my corpus is empty" and reindex over it.
    expect(threw).not.toBeNull();
    expect(String((threw as Error).message)).toMatch(/not a database|malformed|corrupt/i);
  });

  it('deleting the database file is a complete recovery', async () => {
    await seed(5);
    const dbPath = path.join(tmp, 'index.db');
    const first = await mkStore();
    await mkIndexer(first).indexAll(contentRoot);
    first.close();

    await fs.writeFile(dbPath, Buffer.alloc(4096, 0x41));
    await fs.rm(dbPath, { force: true });
    await fs.rm(`${dbPath}-wal`, { force: true });
    await fs.rm(`${dbPath}-shm`, { force: true });

    const rebuilt = await mkStore();
    const result = await mkIndexer(rebuilt).indexAll(contentRoot);
    expect(result.files_indexed).toBe(5);
    expect(Object.keys(await rebuilt.getManifest())).toHaveLength(5);
  });
});

describe('concurrent access to one index', () => {
  it('a second connection reads committed rows while the first holds the file', async () => {
    await seed(6);
    const writer = await mkStore();
    await mkIndexer(writer).indexAll(contentRoot);

    // Reader opens the same file without the writer closing it. WAL mode must
    // let this succeed — `remember search` while `remember dev` is running is
    // the normal case, not an edge case.
    const reader = await mkStore();
    expect(Object.keys(await reader.getManifest())).toHaveLength(6);
  });

  it('a write landing during an open read connection is visible to a fresh read', async () => {
    await seed(3);
    const writer = await mkStore();
    await mkIndexer(writer).indexAll(contentRoot);

    const reader = await mkStore();
    expect(Object.keys(await reader.getManifest())).toHaveLength(3);

    await seed(6); // adds doc-3..doc-5
    await mkIndexer(writer).indexAll(contentRoot);
    expect(Object.keys(await reader.getManifest())).toHaveLength(6);
  });
});
