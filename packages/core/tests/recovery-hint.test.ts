import { describe, it, expect } from 'vitest';
import { recoveryHint } from '../src/cli/index.js';

/**
 * A damaged `.remember/index.db` surfaced as the raw better-sqlite3 string
 * "file is not a database" from status, search, index and doctor alike, with no
 * next step. The index is derived from content/, so deleting it is a lossless
 * recovery — verified end-to-end against a 496-document vault — but nothing said
 * so. These lock the mapping so a later refactor cannot drop the guidance.
 */
describe('recoveryHint', () => {
  const hintFor = (message: string, code?: string) =>
    recoveryHint(Object.assign(new Error(message), code ? { code } : {}));

  it('tells the user how to recover a damaged index', () => {
    const hint = hintFor('file is not a database');
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/\.remember\/index\.db/);
    expect(hint).toMatch(/remember index/);
    // The reassurance matters as much as the command: a user who thinks the
    // index is their data will not run `rm`.
    expect(hint).toMatch(/loses nothing|rebuilt from/i);
  });

  for (const message of [
    'file is not a database',
    'database disk image is malformed',
    'file is encrypted or is not a database',
  ]) {
    it(`recognizes "${message}" as a damaged index`, () => {
      expect(hintFor(message)).toMatch(/remember index/);
    });
  }

  it('treats a schema mismatch as a rebuild, not a bug report', () => {
    expect(hintFor('no such column: subwiki')).toMatch(/remember index/);
  });

  it('points at permissions for a read-only index', () => {
    expect(hintFor('attempt to write a readonly database', 'SQLITE_READONLY')).toMatch(
      /permission/i,
    );
  });

  it('points at the competing process for a lock', () => {
    expect(hintFor('database is locked', 'SQLITE_BUSY')).toMatch(/another remember process/i);
  });

  it('stays silent for errors with no unambiguous next step', () => {
    // A wrong hint is worse than none — do not guess.
    expect(hintFor('something unexpected happened')).toBeNull();
    expect(hintFor('ENOENT: no such file or directory')).toBeNull();
  });
});
