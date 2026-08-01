import { describe, it, expect } from 'vitest';
import { runDoctor, extractH1, type DoctorPageFact, type DoctorDiskFile } from '../src/doctor/doctor.js';

const AT = '2026-07-31T00:00:00.000Z';

function page(overrides: Partial<DoctorPageFact>): DoctorPageFact {
  return {
    path: 'a.md',
    title: 'A',
    frontmatterEmpty: false,
    chunkCount: 2,
    sha256: 'hash-a',
    headingChunks: 2,
    totalChunks: 2,
    firstChunkText: 'x'.repeat(400),
    ...overrides,
  };
}

const disk = (path: string, indexed = true, h1: string | null = 'A'): DoctorDiskFile => ({ path, indexed, h1 });

function checks(findings: ReturnType<typeof runDoctor>['findings'], check: string): string[] {
  return findings.filter((f) => f.check === check).map((f) => f.path);
}

describe('runDoctor checks', () => {
  it('flags a zero-chunk page as an unfindable error', () => {
    const r = runDoctor([page({ path: 'empty.md', chunkCount: 0, totalChunks: 0, headingChunks: 0 })], [disk('empty.md', true, 'X')], AT);
    expect(checks(r.findings, 'unfindable')).toEqual(['empty.md']);
    expect(r.summary.error).toBeGreaterThanOrEqual(1);
  });

  it('flags markdown on disk that is not indexed', () => {
    const r = runDoctor([], [disk('orphan.md', false, null)], AT);
    expect(checks(r.findings, 'not-indexed')).toEqual(['orphan.md']);
  });

  it('flags duplicate bodies (same sha) on every colliding page', () => {
    const r = runDoctor(
      [page({ path: 'a.md', sha256: 'same' }), page({ path: 'b.md', sha256: 'same', title: 'B' })],
      [disk('a.md'), disk('b.md', true, 'B')],
      AT,
    );
    expect(checks(r.findings, 'duplicate-body').sort()).toEqual(['a.md', 'b.md']);
  });

  it('flags duplicate titles case-insensitively', () => {
    const r = runDoctor(
      [page({ path: 'a.md', title: 'Deploy' }), page({ path: 'b.md', title: 'deploy ' })],
      [disk('a.md', true, 'Deploy'), disk('b.md', true, 'deploy')],
      AT,
    );
    expect(checks(r.findings, 'duplicate-title').sort()).toEqual(['a.md', 'b.md']);
  });

  it('distinguishes wall-of-prose (>=3 chunks) from plain no-structure', () => {
    const r = runDoctor(
      [
        page({ path: 'wall.md', chunkCount: 5, totalChunks: 5, headingChunks: 0 }),
        page({ path: 'small.md', chunkCount: 1, totalChunks: 1, headingChunks: 0, firstChunkText: 'y'.repeat(400) }),
      ],
      [disk('wall.md', true, 'W'), disk('small.md', true, 'S')],
      AT,
    );
    expect(checks(r.findings, 'wall-of-prose')).toEqual(['wall.md']);
    expect(checks(r.findings, 'no-structure')).toEqual(['small.md']);
  });

  it('flags a thin page and a title↔H1 mismatch', () => {
    const r = runDoctor(
      [page({ path: 'thin.md', chunkCount: 1, totalChunks: 1, firstChunkText: 'short' })],
      [disk('thin.md', true, 'Different H1')],
      AT,
    );
    expect(checks(r.findings, 'thin-page')).toEqual(['thin.md']);
    expect(checks(r.findings, 'title-mismatch')).toEqual(['thin.md']);
  });

  it('reports a clean corpus with zero findings', () => {
    const r = runDoctor([page({ path: 'good.md', title: 'Good' })], [disk('good.md', true, 'Good')], AT);
    expect(r.findings).toHaveLength(0);
    expect(r.summary).toEqual({ error: 0, warn: 0, info: 0 });
  });
});

describe('extractH1', () => {
  it('reads the first H1 past frontmatter', () => {
    expect(extractH1('---\ntitle: X\n---\n# Real Title\n\nbody')).toBe('Real Title');
  });
  it('returns null when there is no H1', () => {
    expect(extractH1('just prose, no heading')).toBeNull();
  });
});
