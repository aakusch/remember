import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteVecStore } from '../src/stores/sqlite-vec.js';
import { createHashEmbedder } from '../src/embedders/hash.js';
import { createIndexer } from '../src/indexer/index.js';
import { createChokidarWalker } from '../src/walkers/chokidar.js';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';
import { runList, parseListArgs } from '../src/cli/commands/list-cmd.js';
import { runGet, parseGetArgs, GetError } from '../src/cli/commands/get-cmd.js';
import { runStatus } from '../src/cli/commands/status-cmd.js';

// Builds a real temp wiki + index, then exercises the read commands' machine
// (`--json`) paths through their run* helpers. Shapes are locked here because
// agents depend on the field names/order.
describe('CLI read commands over a real index', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-cli-'));
    const contentRoot = path.join(root, 'content');
    await fs.mkdir(contentRoot, { recursive: true });
    await fs.writeFile(
      path.join(contentRoot, 'alpha.md'),
      '---\ntitle: Alpha Doc\ntags: [ops, deploy]\n---\n\n# Alpha\n\nDeploys go out on Tuesdays.',
    );
    await fs.writeFile(
      path.join(contentRoot, 'beta.md'),
      '---\ntitle: Beta Doc\n---\n\n# Beta\n\nAuthentication uses JWT.',
    );
    // Config that does NOT import @useremember/core, so jiti loads it directly.
    await fs.writeFile(path.join(root, 'remember.config.ts'), `export default { content: './content' };\n`);

    const embedder = createHashEmbedder(384);
    const store = await createSqliteVecStore({
      path: path.join(root, '.remember', 'index.db'),
      dim: embedder.dim,
    });
    store.setDimension(embedder.dim);
    const indexer = createIndexer({
      walker: createChokidarWalker({}),
      parser: createRemarkParser(),
      chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
      embedder,
      store,
    });
    await indexer.indexAll(contentRoot);
    store.close();
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('list', () => {
    it('returns the stable ListJsonOutput shape', async () => {
      const out = await runList({ limit: 50, sort: 'path', rootDir: root });
      expect(Object.keys(out)).toEqual(['count', 'total', 'limit', 'sort', 'pages']);
      expect(out.total).toBe(2);
      expect(out.count).toBe(2);
      expect(out.sort).toBe('path');
      expect(out.pages.map((p) => p.path)).toEqual(['alpha.md', 'beta.md']);
      const alpha = out.pages[0]!;
      expect(Object.keys(alpha)).toEqual([
        'path',
        'title',
        'size',
        'last_indexed',
        'last_modified',
        'frontmatter',
      ]);
      expect(alpha.title).toBe('Alpha Doc');
      expect(alpha.frontmatter.tags).toEqual(['ops', 'deploy']);
      expect(typeof alpha.size).toBe('number');
    });

    it('honors --limit', async () => {
      const out = await runList({ limit: 1, sort: 'path', rootDir: root });
      expect(out.count).toBe(1);
      expect(out.total).toBe(2);
    });

    it('honors descending sort', async () => {
      const out = await runList({ limit: 50, sort: '-path', rootDir: root });
      expect(out.pages.map((p) => p.path)).toEqual(['beta.md', 'alpha.md']);
    });

    it('parses args and validates', () => {
      expect(parseListArgs(['--limit', '5', '--sort', '-size', '--json'])).toEqual({
        limit: 5,
        sort: '-size',
        json: true,
      });
      expect(() => parseListArgs(['--limit', 'abc'])).toThrow(/positive integer/);
      expect(() => parseListArgs(['--sort', 'bogus'])).toThrow(/--sort expects/);
      expect(() => parseListArgs(['--nope'])).toThrow(/unknown flag/);
    });
  });

  describe('get', () => {
    it('returns the stable GetJsonOutput shape', async () => {
      const out = await runGet('alpha.md', { rootDir: root });
      expect(Object.keys(out)).toEqual([
        'path',
        'title',
        'frontmatter',
        'body',
        'size',
        'last_modified',
      ]);
      expect(out.path).toBe('alpha.md');
      expect(out.title).toBe('Alpha Doc');
      expect(out.frontmatter.tags).toEqual(['ops', 'deploy']);
      expect(out.body).toContain('Deploys go out on Tuesdays.');
    });

    it('throws PAGE_NOT_FOUND with a code for a missing page', async () => {
      await expect(runGet('missing.md', { rootDir: root })).rejects.toMatchObject({
        code: 'PAGE_NOT_FOUND',
      });
    });

    it('refuses path traversal', async () => {
      await expect(runGet('../secret.md', { rootDir: root })).rejects.toBeInstanceOf(GetError);
    });

    it('parses args and requires a path', () => {
      expect(parseGetArgs(['alpha.md', '--json'])).toEqual({ json: true, path: 'alpha.md' });
      expect(() => parseGetArgs(['--json'])).toThrow(/requires a page path/);
      expect(() => parseGetArgs(['a.md', '--nope'])).toThrow(/unknown flag/);
    });
  });

  describe('status', () => {
    it('returns the stable StatusJsonOutput shape', async () => {
      const out = await runStatus(root);
      expect(Object.keys(out)).toEqual(['version', 'index', 'project']);
      expect(Object.keys(out.index)).toEqual(['pages', 'chunks', 'embedder', 'last_indexed']);
      expect(out.index.pages).toBe(2);
      expect(out.index.chunks).toBeGreaterThanOrEqual(2);
      expect(out.project.content_path).toBe(path.join(root, 'content'));
    });
  });
});
