import path from 'node:path';
import { realpathSync } from 'node:fs';

export class PathOutsideContentError extends Error {
  code = 'PATH_OUTSIDE_CONTENT' as const;
  constructor(p: string) {
    super(`Refused path traversal: "${p}" resolves outside content/`);
  }
}

/**
 * Resolve a user-supplied path against the content root and verify it stays inside.
 * Returns the absolute path on success; throws PathOutsideContentError otherwise.
 */
export function safeJoinContent(contentRoot: string, userPath: string): string {
  // A NUL byte makes fs throw ERR_INVALID_ARG_VALUE (an unmapped 500) rather than
  // our clean 400; reject it up front as an invalid path.
  if (userPath.includes('\0')) {
    throw new PathOutsideContentError(userPath);
  }
  const normalized = path.normalize(userPath).replace(/^[/\\]+/, '');
  const abs = path.resolve(contentRoot, normalized);
  const rel = path.relative(contentRoot, abs);
  // Why: an empty/'.'/root-resolving path passes the `..` guard (path.relative → '')
  // and previously let `DELETE /v1/folders/?recursive=true` fs.rm the entire content
  // root. A user path must always name something *inside* content/, never the root.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathOutsideContentError(userPath);
  }
  assertRealPathInside(contentRoot, abs, userPath);
  return abs;
}

/**
 * The lexical check above is not enough on its own: it reasons about the string,
 * and a symlink makes the string lie. `ln -s /etc content/x` leaves
 * `content/x/passwd` looking perfectly contained while resolving somewhere else
 * entirely — readable through GET /v1/pages, writable through PUT.
 *
 * So resolve symlinks for real and re-check containment. The target usually does
 * not exist yet (every write creates a new page), so walk up to the nearest
 * ancestor that does and resolve that — the deepest real directory is where a
 * symlink could be hiding. The content root itself is resolved too, otherwise a
 * root that is *legitimately* a symlink would fail every comparison.
 */
function assertRealPathInside(contentRoot: string, abs: string, userPath: string): void {
  let realRoot: string;
  try {
    realRoot = realpathSync(contentRoot);
  } catch {
    // No content root on disk yet — nothing to escape into.
    return;
  }

  let probe = abs;
  for (;;) {
    try {
      const real = realpathSync(probe);
      const relReal = path.relative(realRoot, real);
      // An existing ancestor may legitimately BE the root, so '' is allowed here
      // (unlike the lexical check, which is guarding the caller's own path).
      if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
        throw new PathOutsideContentError(userPath);
      }
      return;
    } catch (err) {
      if (err instanceof PathOutsideContentError) throw err;
      const parent = path.dirname(probe);
      if (parent === probe) return; // reached the filesystem root; nothing resolved
      probe = parent;
    }
  }
}
