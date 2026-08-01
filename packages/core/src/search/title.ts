import path from 'node:path';

/** A file's basename without the .md extension — the title fallback. Shared so the
 *  "frontmatter title else basename" logic isn't re-implemented per command. */
export function basenameTitle(p: string): string {
  return path.basename(p).replace(/\.md$/i, '');
}

/**
 * Derive a display title for a search result: the frontmatter `title` when set,
 * else the file's basename. Shared by the CLI (`--json`) and the HTTP `/v1/search`
 * projection so the two agent-facing surfaces never disagree on the field set.
 */
export function titleFor(r: { path: string; frontmatter?: Record<string, unknown> }): string {
  const t = r.frontmatter?.title;
  if (typeof t === 'string' && t.trim()) return t.trim();
  return basenameTitle(r.path);
}
