import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeJoinContent, PathOutsideContentError } from '../src/api/path-utils.js';

/**
 * Symlink containment against a REAL filesystem.
 *
 * `path-utils.test.ts` uses a content root that does not exist on disk, so
 * `realpathSync(contentRoot)` throws and the whole symlink check returns early —
 * those cases only cover the lexical guard. Everything here needs real inodes.
 *
 * The dangling/looping cases are the regression guard. `realpathSync` throws the
 * same ENOENT for "this path does not exist yet" (legitimate — every page write
 * creates one) and for "this path IS a symlink that points nowhere". Treating the
 * second as the first walked past the link to its parent, declared the parent
 * contained, and allowed the operation — and `fs.writeFile` then follows the link
 * and writes wherever it points. `ln -s /etc/cron.d/x content/note.md` turned
 * `PUT /v1/pages/note.md` into a write outside content/.
 */
describe('safeJoinContent — symlink containment on a real filesystem', () => {
  let tmp: string;
  let contentRoot: string;
  let outside: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-symlink-'));
    contentRoot = path.join(tmp, 'content');
    outside = path.join(tmp, 'outside');
    await fs.mkdir(path.join(contentRoot, 'sub'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(contentRoot, 'ok.md'), '# ok\n');
    await fs.writeFile(path.join(outside, 'secret.md'), '# secret\n');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('allows a real file inside the root', () => {
    expect(safeJoinContent(contentRoot, 'ok.md')).toBe(path.join(contentRoot, 'ok.md'));
  });

  it('allows a path that does not exist yet (create)', () => {
    expect(safeJoinContent(contentRoot, 'sub/new.md')).toBe(path.join(contentRoot, 'sub/new.md'));
  });

  it('refuses a symlink that escapes the root', async () => {
    await fs.symlink(outside, path.join(contentRoot, 'escape'));
    expect(() => safeJoinContent(contentRoot, 'escape/secret.md')).toThrow(PathOutsideContentError);
  });

  it('refuses a DANGLING symlink — a write through it lands outside content/', async () => {
    await fs.symlink(path.join(outside, 'not-created-yet.md'), path.join(contentRoot, 'note.md'));
    expect(() => safeJoinContent(contentRoot, 'note.md')).toThrow(PathOutsideContentError);
  });

  it('refuses a dangling symlink used as a directory component', async () => {
    await fs.symlink(path.join(outside, 'nowhere'), path.join(contentRoot, 'dir'));
    expect(() => safeJoinContent(contentRoot, 'dir/page.md')).toThrow(PathOutsideContentError);
  });

  it('refuses a symlink LOOP (ELOOP, not ENOENT)', async () => {
    await fs.symlink(path.join(contentRoot, 'b'), path.join(contentRoot, 'a'));
    await fs.symlink(path.join(contentRoot, 'a'), path.join(contentRoot, 'b'));
    expect(() => safeJoinContent(contentRoot, 'a')).toThrow(PathOutsideContentError);
  });

  it('still allows a symlink that stays inside the root', async () => {
    await fs.symlink(path.join(contentRoot, 'sub'), path.join(contentRoot, 'alias'));
    expect(() => safeJoinContent(contentRoot, 'alias/page.md')).not.toThrow();
  });

  it('allows a content root that is itself a symlink', async () => {
    const aliasRoot = path.join(tmp, 'content-alias');
    await fs.symlink(contentRoot, aliasRoot);
    expect(() => safeJoinContent(aliasRoot, 'ok.md')).not.toThrow();
  });
});
