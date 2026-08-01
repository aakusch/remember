import path from 'node:path';

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
  return abs;
}
