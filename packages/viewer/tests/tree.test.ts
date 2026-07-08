import { describe, it, expect } from 'vitest';
import { buildTree, buildCrumbs, slugify, findAdjacent, extractToc } from '../src/lib/tree.js';

describe('buildTree', () => {
  it('groups files under folders, folders first then files, alphabetical', () => {
    const tree = buildTree([
      { path: 'b.md' },
      { path: 'ops/deploy.md' },
      { path: 'ops/runbook.md' },
      { path: 'a.md' },
    ]);
    // Folder "ops" sorts before files a.md, b.md.
    expect(tree.map((n) => n.name)).toEqual(['ops', 'a.md', 'b.md']);
    const ops = tree.find((n) => n.name === 'ops')!;
    expect(ops.isFile).toBe(false);
    expect(ops.children!.map((c) => c.name)).toEqual(['deploy.md', 'runbook.md']);
    expect(ops.children!.every((c) => c.isFile)).toBe(true);
  });

  it('preserves the full cumulative path on each node', () => {
    const tree = buildTree([{ path: 'a/b/c.md' }]);
    const a = tree[0]!;
    expect(a.path).toBe('a');
    const b = a.children![0]!;
    expect(b.path).toBe('a/b');
    const c = b.children![0]!;
    expect(c.path).toBe('a/b/c.md');
    expect(c.isFile).toBe(true);
  });

  it('returns an empty array for no pages', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('buildCrumbs', () => {
  it('builds cumulative crumbs and strips the .md extension', () => {
    expect(buildCrumbs('ops/runbooks/deploy.md')).toEqual([
      { name: 'ops', path: 'ops' },
      { name: 'runbooks', path: 'ops/runbooks' },
      { name: 'deploy', path: 'ops/runbooks/deploy' },
    ]);
  });

  it('handles a single top-level page', () => {
    expect(buildCrumbs('readme.md')).toEqual([{ name: 'readme', path: 'readme' }]);
  });
});

describe('slugify', () => {
  it('lowercases, strips punctuation, and hyphenates spaces', () => {
    expect(slugify('OAuth Flow!')).toBe('oauth-flow');
    expect(slugify('  Hello   World  ')).toBe('hello-world');
  });
});

describe('findAdjacent', () => {
  const pages = [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }];

  it('finds prev and next around a middle page', () => {
    expect(findAdjacent(pages, 'b.md')).toEqual({ prev: { path: 'a.md' }, next: { path: 'c.md' } });
  });

  it('returns null prev at the start and null next at the end', () => {
    expect(findAdjacent(pages, 'a.md').prev).toBeNull();
    expect(findAdjacent(pages, 'c.md').next).toBeNull();
  });

  it('returns both null for an unknown page', () => {
    expect(findAdjacent(pages, 'missing.md')).toEqual({ prev: null, next: null });
  });
});

describe('extractToc', () => {
  it('extracts H2-H6 headings, skipping H1 and code blocks', () => {
    const md = [
      '# Title',
      '## Section One',
      '```',
      '## Not a heading (in code)',
      '```',
      '### Sub Section',
    ].join('\n');
    const toc = extractToc(md);
    expect(toc).toEqual([
      { level: 2, text: 'Section One', slug: 'section-one' },
      { level: 3, text: 'Sub Section', slug: 'sub-section' },
    ]);
  });
});
