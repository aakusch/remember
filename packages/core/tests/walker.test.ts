import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFsWalker } from '../src/walkers/fs-walker.js';

describe('ChokidarWalker', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-walker-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('walks .md files and skips non-markdown', async () => {
    await fs.writeFile(path.join(tmp, 'a.md'), '# A');
    await fs.writeFile(path.join(tmp, 'b.txt'), 'not markdown');
    await fs.mkdir(path.join(tmp, 'sub'));
    await fs.writeFile(path.join(tmp, 'sub', 'c.md'), '# C');

    const walker = createFsWalker({});
    const out: string[] = [];
    for await (const e of walker.walk(tmp)) out.push(e.path);
    out.sort();
    expect(out).toEqual(['a.md', 'sub/c.md']);
  });

  it('skips default ignore patterns (drafts/, node_modules/, _*/, .git/)', async () => {
    await fs.writeFile(path.join(tmp, 'keep.md'), '# keep');
    await fs.mkdir(path.join(tmp, 'drafts'));
    await fs.writeFile(path.join(tmp, 'drafts', 'wip.md'), '# wip');
    await fs.mkdir(path.join(tmp, 'node_modules'));
    await fs.writeFile(path.join(tmp, 'node_modules', 'dep.md'), '# dep');
    await fs.mkdir(path.join(tmp, '_private'));
    await fs.writeFile(path.join(tmp, '_private', 'secret.md'), '# secret');

    const walker = createFsWalker({});
    const out: string[] = [];
    for await (const e of walker.walk(tmp)) out.push(e.path);
    expect(out).toEqual(['keep.md']);
  });

  it('respects .rememberignore', async () => {
    await fs.writeFile(path.join(tmp, 'keep.md'), '# keep');
    await fs.writeFile(path.join(tmp, 'skip.md'), '# skip');
    await fs.writeFile(path.join(tmp, '.rememberignore'), 'skip.md\n');

    const walker = createFsWalker({});
    const out: string[] = [];
    for await (const e of walker.walk(tmp)) out.push(e.path);
    expect(out).toEqual(['keep.md']);
  });

  it('emits stable sha256 per content', async () => {
    await fs.writeFile(path.join(tmp, 'x.md'), 'hello world');
    const walker = createFsWalker({});
    const [first] = await collect(walker, tmp);
    const [second] = await collect(walker, tmp);
    expect(first!.sha256).toBe(second!.sha256);
    expect(first!.sha256).toHaveLength(64);
  });
});

async function collect(walker: ReturnType<typeof createFsWalker>, root: string) {
  const out = [];
  for await (const e of walker.walk(root)) out.push(e);
  return out;
}
