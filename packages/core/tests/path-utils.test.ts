import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { safeJoinContent, PathOutsideContentError } from '../src/api/path-utils.js';

const ROOT = '/wiki/content';

describe('safeJoinContent', () => {
  it('resolves a normal nested path inside the content root', () => {
    expect(safeJoinContent(ROOT, 'notes/a.md')).toBe(path.resolve(ROOT, 'notes/a.md'));
  });

  it('strips a leading slash rather than treating it as absolute', () => {
    expect(safeJoinContent(ROOT, '/a.md')).toBe(path.resolve(ROOT, 'a.md'));
  });

  for (const evil of ['', '.', './', '..', '../secret', '../../etc/passwd', 'a/../..']) {
    it(`rejects "${evil}" (escapes or resolves to the content root itself)`, () => {
      // The empty/'.'/root-resolving cases are the regression guard: they used to
      // let DELETE /v1/folders/?recursive=true fs.rm the entire content root.
      expect(() => safeJoinContent(ROOT, evil)).toThrow(PathOutsideContentError);
    });
  }
});
