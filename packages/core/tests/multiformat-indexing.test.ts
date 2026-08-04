import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createSqliteVecStore, type SqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createIndexer } from '../src/indexer/index.js';
import { createFsWalker } from '../src/walkers/fs-walker.js';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';
import { createFormatRouter, type FormatName } from '../src/parsers/format-router.js';

/**
 * End-to-end multi-format indexing, asserted against the SQLite database.
 *
 * Deliberately not asserting on parser return values: a parser unit test cannot
 * catch a walker that never yields the file, or that yields a zip archive as a
 * utf8 string and corrupts it before the parser is even called. Those are the
 * two failure modes that actually break multi-format ingestion.
 */

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/office',
);

describe('multi-format indexing (real pipeline, asserted against the DB)', () => {
  let tmp: string;
  let contentRoot: string;
  let dbPath: string;
  let store: SqliteVecStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-multiformat-'));
    contentRoot = path.join(tmp, 'content');
    dbPath = path.join(tmp, 'index.db');
    await fs.mkdir(contentRoot, { recursive: true });
  });

  afterEach(async () => {
    try {
      store?.close();
    } catch {
      // already closed
    }
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function copyFixture(name: string, rel: string): Promise<void> {
    const target = path.join(contentRoot, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(FIXTURES, name), target);
  }

  async function buildIndexer(formats: FormatName[]) {
    const embedder = createHashEmbedder(384);
    store = await createSqliteVecStore({ path: dbPath, dim: embedder.dim });
    const router = createFormatRouter({ formats });
    return createIndexer({
      walker: createFsWalker({
        respectGitignore: false,
        extensions: router.extensions,
        binaryExtensions: router.binaryExtensions,
      }),
      parser: router.parser,
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
      binaryExtensions: router.binaryExtensions,
    });
  }

  function readChunks(): Array<{ source_path: string; heading_path: string; text: string }> {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db
        .prepare(
          'select source_path, heading_path, text from chunks order by source_path, chunk_idx',
        )
        .all() as Array<{ source_path: string; heading_path: string; text: string }>;
    } finally {
      db.close();
    }
  }

  function headingPathsFor(sourcePath: string): string[][] {
    return readChunks()
      .filter((r) => r.source_path === sourcePath)
      .map((r) => JSON.parse(r.heading_path) as string[]);
  }

  it('populates heading_path in the DB for an ODT document', async () => {
    await copyFixture('access-control.odt', 'security/access-control.odt');
    const indexer = await buildIndexer(['md', 'odt']);
    expect((await indexer.indexAll(contentRoot)).files_indexed).toBe(1);

    const paths = headingPathsFor('security/access-control.odt');
    expect(paths.length).toBeGreaterThan(0);
    // Not one empty heading_path anywhere — the bug that has shipped before.
    expect(paths.every((p) => p.length > 0)).toBe(true);
    expect(paths).toContainEqual(['Access control', 'Requesting access']);
    expect(paths).toContainEqual(['Access control', 'Requesting access', 'Break-glass accounts']);
  });

  it('populates heading_path in the DB for a PPTX deck', async () => {
    await copyFixture('incident-deck.pptx', 'decks/incident-deck.pptx');
    const indexer = await buildIndexer(['md', 'pptx']);
    expect((await indexer.indexAll(contentRoot)).files_indexed).toBe(1);

    expect(headingPathsFor('decks/incident-deck.pptx')).toContainEqual(['Escalation path']);
    // Slide bullets must stay separate lines, not fuse into one run of text.
    const text = readChunks()
      .map((r) => r.text)
      .join('\n');
    expect(text).not.toMatch(/immediately\.Sev2/);
  });

  it('indexes a spreadsheet as rows carrying the real table values', async () => {
    await copyFixture('retention-schedule.xlsx', 'data/retention-schedule.xlsx');
    const indexer = await buildIndexer(['md', 'xlsx']);
    expect((await indexer.indexAll(contentRoot)).files_indexed).toBe(1);

    const text = readChunks()
      .map((r) => r.text)
      .join('\n');
    expect(text).toContain('Audit logs | 7 years | security');
    // The GFM delimiter row anydoc emits must never reach the index.
    expect(text).not.toMatch(/\|\s*-{3,}/);
  });

  it('walks a mixed corpus of every enabled format in one pass', async () => {
    await fs.writeFile(path.join(contentRoot, 'readme.md'), '# Readme\n\nMarkdown still works.');
    await copyFixture('access-control.odt', 'security/access-control.odt');
    await copyFixture('incident-deck.pptx', 'decks/incident-deck.pptx');
    await copyFixture('secrets-management.rtf', 'security/secrets-management.rtf');
    await copyFixture('service-catalog.csv', 'data/service-catalog.csv');
    await copyFixture('deploy-guide.epub', 'platform/deploy-guide.epub');

    const indexer = await buildIndexer(['md', 'odt', 'pptx', 'rtf', 'csv', 'epub']);
    expect((await indexer.indexAll(contentRoot)).files_indexed).toBe(6);

    expect(new Set(readChunks().map((r) => r.source_path))).toEqual(
      new Set([
        'readme.md',
        'security/access-control.odt',
        'decks/incident-deck.pptx',
        'security/secrets-management.rtf',
        'data/service-catalog.csv',
        'platform/deploy-guide.epub',
      ]),
    );
  });

  it('ignores every office file when formats is left at its default', async () => {
    await fs.writeFile(path.join(contentRoot, 'readme.md'), '# Readme\n\nMarkdown only.');
    await copyFixture('incident-deck.pptx', 'decks/incident-deck.pptx');
    await copyFixture('access-control.odt', 'security/access-control.odt');

    const indexer = await buildIndexer(['md']);
    expect((await indexer.indexAll(contentRoot)).files_indexed).toBe(1);
    expect(new Set(readChunks().map((r) => r.source_path))).toEqual(new Set(['readme.md']));
  });

  it('indexes the rest of the corpus when one office file is corrupt', async () => {
    await fs.writeFile(path.join(contentRoot, 'readme.md'), '# Readme\n\nStill here.');
    await fs.mkdir(path.join(contentRoot, 'decks'), { recursive: true });
    await fs.writeFile(path.join(contentRoot, 'decks/broken.pptx'), 'not a deck at all');

    const indexer = await buildIndexer(['md', 'pptx']);
    const result = await indexer.indexAll(contentRoot);
    expect(result.files_indexed).toBe(2);
    // Degraded to an empty page, not an indexing error.
    expect(result.errors).toEqual([]);

    const sources = new Set(readChunks().map((r) => r.source_path));
    expect(sources).toContain('readme.md');
    expect(sources).not.toContain('decks/broken.pptx');
  });

  it('populates heading_path in the DB for a PDF', async () => {
    // PDF goes through parsers/pdf.ts (pdf-inspector), not anydoc — its
    // font-size-ratio heading detection emits the ATX markers the chunker needs.
    const target = path.join(contentRoot, 'platform/runbook.pdf');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(FIXTURES, '../runbook.pdf'), target);

    const indexer = await buildIndexer(['md', 'pdf']);
    expect((await indexer.indexAll(contentRoot)).files_indexed).toBe(1);

    const paths = headingPathsFor('platform/runbook.pdf');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.length > 0)).toBe(true);
  });

  it('records a scanned PDF as an empty page instead of failing the run', async () => {
    // The behaviour anydoc could not give us: a scanned PDF is classified, named
    // in a warning, and recorded — not surfaced as an indexing error.
    await fs.writeFile(path.join(contentRoot, 'readme.md'), '# Readme\n\nStill here.');
    await fs.writeFile(path.join(contentRoot, 'scan.pdf'), 'not really a pdf');

    const indexer = await buildIndexer(['md', 'pdf']);
    const result = await indexer.indexAll(contentRoot);
    expect(result.files_indexed).toBe(2);
    expect(result.errors).toEqual([]);
    const sources = new Set(readChunks().map((r) => r.source_path));
    expect(sources).toContain('readme.md');
    expect(sources).not.toContain('scan.pdf');
  });

  it('skips unchanged office files on re-run (hash covers the real bytes)', async () => {
    await copyFixture('access-control.odt', 'security/access-control.odt');
    await copyFixture('incident-deck.pptx', 'decks/incident-deck.pptx');
    const indexer = await buildIndexer(['md', 'odt', 'pptx']);

    expect((await indexer.indexAll(contentRoot)).files_indexed).toBe(2);
    const second = await indexer.indexAll(contentRoot);
    expect(second.files_indexed).toBe(0);
    expect(second.files_skipped).toBe(2);
  });

  it('indexOne reads a binary format as bytes, matching the walk', async () => {
    // indexOne reads the file itself, so it needs the binary list too. Without
    // it the zip is read as utf8 and the document silently indexes as nothing.
    await copyFixture('access-control.odt', 'security/access-control.odt');
    const indexer = await buildIndexer(['md', 'odt']);
    const result = await indexer.indexOne(contentRoot, 'security/access-control.odt');

    expect(result.chunks_added).toBeGreaterThan(0);
    expect(headingPathsFor('security/access-control.odt')).toContainEqual([
      'Access control',
      'Revocation',
    ]);
  });

  it('markdown-only pipelines are unchanged, and reject bytes loudly', async () => {
    // A legacy embedder that passes createRemarkParser() must keep working; if a
    // binary extension is enabled on the walker without a DocumentParser to read
    // it, that is a wiring bug and must say so rather than index mojibake.
    await copyFixture('access-control.odt', 'security/access-control.odt');
    const embedder = createHashEmbedder(384);
    store = await createSqliteVecStore({ path: dbPath, dim: embedder.dim });
    const indexer = createIndexer({
      walker: createFsWalker({
        respectGitignore: false,
        extensions: ['.md', '.odt'],
        binaryExtensions: ['.odt'],
      }),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
    });

    const result = await indexer.indexAll(contentRoot);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toMatch(/markdown-only parser/);
  });
});
