import { describe, expect, it } from 'vitest';
import { applyStatusDemotion } from '../src/search/hybrid.js';
import type { SearchResult } from '../src/types.js';

function hit(path: string, score: number, frontmatter: Record<string, unknown> = {}): SearchResult {
  return {
    path,
    chunk_idx: 0,
    snippet: '',
    frontmatter,
    score,
    retrievers: ['bm25'],
    chunk_id: `${path}#0`,
  };
}

describe('applyStatusDemotion', () => {
  it('ranks the current document above a superseded one that scored higher', () => {
    // The measured failure: on the confusable fixture a stale document took
    // rank 1 on 54% of queries, and 7 of 8 of those already declared their own
    // status. Retrieval relevance alone cannot separate them.
    const out = applyStatusDemotion(
      [
        hit('adr-007-old.md', 1.0, { status: 'superseded' }),
        hit('adr-011-current.md', 0.9, { status: 'current' }),
      ],
      0.5,
    );

    expect(out.map((h) => h.path)).toEqual(['adr-011-current.md', 'adr-007-old.md']);
  });

  it('demotes every non-current lifecycle state', () => {
    for (const status of ['superseded', 'deprecated', 'archived', 'draft', 'rejected']) {
      const out = applyStatusDemotion(
        [hit('stale.md', 1.0, { status }), hit('live.md', 0.9, { status: 'current' })],
        0.5,
      );
      expect(out[0]!.path, `status=${status} should be demoted`).toBe('live.md');
    }
  });

  it('leaves documents without a status field untouched', () => {
    // Most real corpora have no status frontmatter at all. Absence must never
    // be treated as staleness, or every unlabelled document gets penalised.
    const out = applyStatusDemotion([hit('a.md', 1.0), hit('b.md', 0.9)], 0.5);
    expect(out.map((h) => h.path)).toEqual(['a.md', 'b.md']);
    expect(out[0]!.score).toBe(1.0);
  });

  it('does not demote unknown status values', () => {
    const out = applyStatusDemotion(
      [hit('a.md', 1.0, { status: 'living' }), hit('b.md', 0.9, { status: 'current' })],
      0.5,
    );
    expect(out.map((h) => h.path)).toEqual(['a.md', 'b.md']);
  });

  it('is case and whitespace insensitive', () => {
    const out = applyStatusDemotion(
      [hit('stale.md', 1.0, { status: '  Deprecated ' }), hit('live.md', 0.9)],
      0.5,
    );
    expect(out[0]!.path).toBe('live.md');
  });

  it('can be disabled with a factor of 1', () => {
    const out = applyStatusDemotion(
      [hit('stale.md', 1.0, { status: 'superseded' }), hit('live.md', 0.9)],
      1,
    );
    expect(out.map((h) => h.path)).toEqual(['stale.md', 'live.md']);
  });

  it('keeps a stale document ahead of an irrelevant one', () => {
    // Demotion must not bury a stale-but-on-topic document beneath noise: it is
    // often the only source, and the caller can still see its status.
    const out = applyStatusDemotion(
      [hit('stale.md', 1.0, { status: 'archived' }), hit('noise.md', 0.1)],
      0.5,
    );
    expect(out.map((h) => h.path)).toEqual(['stale.md', 'noise.md']);
  });
});
