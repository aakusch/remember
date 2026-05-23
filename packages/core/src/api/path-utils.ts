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
  const normalized = path.normalize(userPath).replace(/^[/\\]+/, '');
  const abs = path.resolve(contentRoot, normalized);
  const rel = path.relative(contentRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathOutsideContentError(userPath);
  }
  return abs;
}
