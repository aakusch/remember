import { describe, it, expect } from 'vitest';
import {
  buildJsonOutput,
  titleFor,
  searchCommand,
  type SearchJsonOutput,
} from '../src/cli/commands/search-cmd.js';
import type { SearchResult } from '../src/types.js';

function fakeResult(over: Partial<SearchResult> = {}): SearchResult {
  return {
    path: 'guide/deploy.md',
    chunk_idx: 0,
    snippet: 'How to deploy to production safely.',
    frontmatter: { title: 'Deploy runbook', status: 'current' },
    score: 0.123456789,
    retrievers: ['bm25', 'vector'],
    chunk_id: 'guide/deploy.md#0',
    heading_path: ['Deploy', 'Production'],
    ...over,
  };
}

describe('search --json machine output', () => {
  it('produces a stable, color-free shape', () => {
    const out = buildJsonOutput('deploy', [fakeResult()], 12.7);
    const expected: SearchJsonOutput = {
      query: 'deploy',
      count: 1,
      query_ms: 13,
      results: [
        {
          rank: 1,
          score: 0.123457, // rounded to 6dp
          path: 'guide/deploy.md',
          title: 'Deploy runbook',
          snippet: 'How to deploy to production safely.',
          heading_path: ['Deploy', 'Production'],
          retrievers: ['bm25', 'vector'],
          chunk_id: 'guide/deploy.md#0',
          frontmatter: { title: 'Deploy runbook', status: 'current' },
        },
      ],
    };
    expect(out).toEqual(expected);
  });

  it('serializes to JSON with no ANSI escape codes', () => {
    const out = buildJsonOutput('deploy', [fakeResult(), fakeResult({ path: 'b.md' })], 5);
    const str = JSON.stringify(out);
    // eslint-disable-next-line no-control-regex
    expect(str).not.toMatch(/\[/);
    expect(out.count).toBe(2);
    expect(out.results[1]!.rank).toBe(2);
  });

  it('ranks are 1-based and sequential', () => {
    const out = buildJsonOutput('x', [fakeResult(), fakeResult(), fakeResult()], 1);
    expect(out.results.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('empty results yield count 0 and an empty array', () => {
    const out = buildJsonOutput('nothing', [], 3);
    expect(out.count).toBe(0);
    expect(out.results).toEqual([]);
  });
});

describe('titleFor', () => {
  it('prefers frontmatter title', () => {
    expect(titleFor(fakeResult({ frontmatter: { title: 'Hello' } }))).toBe('Hello');
  });

  it('falls back to the basename without .md', () => {
    expect(titleFor(fakeResult({ frontmatter: {}, path: 'notes/auth-flow.md' }))).toBe('auth-flow');
  });

  it('ignores a blank title', () => {
    expect(titleFor(fakeResult({ frontmatter: { title: '   ' }, path: 'a/b.md' }))).toBe('b');
  });
});

describe('searchCommand argument handling', () => {
  it('rejects an empty query before touching the index', async () => {
    await expect(searchCommand([])).rejects.toThrow(/requires a query/);
  });

  it('rejects an unknown flag', async () => {
    await expect(searchCommand(['hi', '--nope'])).rejects.toThrow(/unknown flag/);
  });

  it('rejects a non-numeric -k', async () => {
    await expect(searchCommand(['hi', '-k', 'abc'])).rejects.toThrow(/positive integer/);
  });

  it('tags bad-invocation errors with a stable USAGE code', async () => {
    // The --json error emitter reports `error.code`; usage errors must not fall
    // back to the blanket COMMAND_ERROR so agents can distinguish a bad call
    // from a runtime failure.
    await expect(searchCommand([])).rejects.toMatchObject({ code: 'USAGE' });
    await expect(searchCommand(['hi', '--nope'])).rejects.toMatchObject({ code: 'USAGE' });
    await expect(searchCommand(['hi', '-k', 'abc'])).rejects.toMatchObject({ code: 'USAGE' });
  });
});
