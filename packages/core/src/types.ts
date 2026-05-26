// Adapter interfaces for the remember pipeline.
// Single file in the scaffold; will split per-adapter in implementation.

export interface Walker {
  walk(root: string): AsyncIterable<{
    path: string;
    content: string;
    mtime: Date;
    sha256: string;
  }>;
}

export interface Parser {
  parse(raw: string): {
    frontmatter: Record<string, unknown>;
    ast: unknown;
    plain: string;
  };
}

export interface Chunk {
  id: string;
  source_path: string;
  chunk_idx: number;
  text: string;
  heading_path: string[];
}

export interface Chunker {
  chunk(parsed: { plain: string; ast?: unknown }): Chunk[];
}

export interface Embedder {
  readonly dim: number;
  readonly modelId: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface SearchResult {
  path: string;
  chunk_idx: number;
  snippet: string;
  frontmatter: Record<string, unknown>;
  score: number;
  retrievers: ('bm25' | 'vector')[];
  chunk_id: string;
  /**
   * Markdown heading hierarchy the chunk lives under, e.g.
   * `['Authentication', 'OAuth flow']`. Stored at chunk-time by the
   * indexer; consumed by `applyHeadingBoost` to score chunks under
   * relevant headings higher.
   */
  heading_path?: string[];
}

export interface SearchEngine {
  query(
    q: string,
    opts: { k?: number; debug?: boolean },
  ): Promise<{
    results: SearchResult[];
    query_ms: number;
    debug?: unknown;
  }>;
}

export interface Reranker {
  rerank(query: string, candidates: SearchResult[]): Promise<SearchResult[]>;
}

export interface PageRecord {
  path: string;
  frontmatter: Record<string, unknown>;
  title: string | null;
  size: number;
  last_indexed: string;
  last_modified: string;
}

export interface PageQuery {
  /** Per-key filters. Exact match for scalars; array-membership for array values (e.g. tags). */
  filter?: Record<string, string>;
  /** Sort by 'path' | 'last_modified' | 'title' | frontmatter key. Prefix with - for descending. */
  sort?: string;
  /** Free-text contains across title + path. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface Store {
  upsert(chunks: Array<Chunk & { embedding: number[] }>): Promise<void>;
  deleteByPath(path: string): Promise<number>;
  searchVector(embedding: number[], k: number, query?: string): Promise<SearchResult[]>;
  searchBm25(query: string, k: number): Promise<SearchResult[]>;
  getManifest(): Promise<
    Record<string, { sha256: string; chunk_count: number; last_indexed: string }>
  >;
  updateManifest(
    path: string,
    entry: { sha256: string; chunk_count: number; last_indexed: string } | null,
  ): Promise<void>;
  upsertPage(record: PageRecord): Promise<void>;
  deletePage(path: string): Promise<void>;
  queryPages(query: PageQuery): Promise<{ rows: PageRecord[]; total: number }>;
  listFrontmatterKeys(): Promise<string[]>;
}

export interface RememberConfig {
  name?: string;
  description?: string;
  content?: string;
  server?: {
    host?: string;
    port?: number;
    apiPort?: number;
    adminToken?: string | null;
  };
  pipeline?: {
    walker?: unknown;
    parser?: unknown;
    chunker?: unknown;
    embedder?: unknown;
    store?: unknown;
  };
  search?: {
    engine?: unknown;
  };
  connectors?: unknown[];
  index?: {
    watchMode?: 'on' | 'off' | 'on-dev-only';
    debounceMs?: number;
    onStaleModel?: 'prompt' | 'auto-reembed' | 'ignore';
  };
  viewer?: {
    landing?: string;
    showAdmin?: boolean;
    breadcrumbs?: boolean;
  };
  schemaVersion?: number;
}
