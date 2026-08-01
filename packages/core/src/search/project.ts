import type { SearchResult } from '../types.js';
import { titleFor } from './title.js';

/** The whitelisted, agent-facing search-result shape (CLAUDE.md's /v1/search contract). */
export interface ProjectedResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
  frontmatter: Record<string, unknown>;
  heading_path: string[];
  retrievers: SearchResult['retrievers'];
  chunk_id: string;
}

/**
 * Project an internal SearchResult to the exact whitelisted field set — adding
 * `title`, dropping the internal `chunk_idx`. Shared by `/v1/search`, the CLI
 * `--json`, and the MCP `search_wiki` tool so every surface returns the same shape.
 */
export function projectSearchResult(r: SearchResult): ProjectedResult {
  return {
    path: r.path,
    title: titleFor(r),
    snippet: r.snippet,
    score: r.score,
    frontmatter: r.frontmatter,
    heading_path: r.heading_path ?? [],
    retrievers: r.retrievers,
    chunk_id: r.chunk_id,
  };
}
