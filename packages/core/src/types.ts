// Adapter interfaces for the remember pipeline.
// Single file in the scaffold; will split per-adapter in implementation.

export interface WalkEntry {
  path: string;
  /**
   * File contents. A `string` for text formats; raw bytes for any extension the
   * walker was told is binary. A `.docx`/`.pptx`/`.xlsx` is a zip archive and a
   * `.doc` is an OLE container — reading either as utf8 corrupts it
   * irrecoverably, so binary formats must be declared rather than sniffed.
   */
  content: string | Uint8Array;
  mtime: Date;
  sha256: string;
}

export interface Walker {
  walk(root: string): AsyncIterable<WalkEntry>;
}

export interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  ast: unknown;
  plain: string;
}

/**
 * Legacy single-format parser. Markdown-only and synchronous. Deliberately
 * unchanged: it is part of the published `@useremember/core` surface and every
 * existing consumer calls `parse(raw: string)`. New formats implement
 * `DocumentParser` instead.
 */
export interface Parser {
  parse(raw: string): ParsedDocument;
}

/**
 * Multi-format parser. Async because non-markdown formats need a lazily
 * imported converter, and path-aware because format dispatch keys off the file
 * extension rather than sniffing content.
 */
export interface DocumentParser {
  readonly kind: 'document';
  /** Extensions this parser claims, lowercase and dot-prefixed (`['.rtf']`). */
  readonly extensions: string[];
  /** Subset of `extensions` whose content must be delivered as raw bytes. */
  readonly binaryExtensions: string[];
  parseDocument(input: { path: string; content: string | Uint8Array }): Promise<ParsedDocument>;
}

/** Narrow a `Parser | DocumentParser` union without instanceof. */
export function isDocumentParser(p: Parser | DocumentParser): p is DocumentParser {
  return (p as DocumentParser).kind === 'document';
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
  /** Max input the model embeds before it truncates (tokens). The chunker sizes to
   *  this so a chunk's vector isn't silently built from only its first N tokens. */
  readonly maxInputTokens: number;
  embed(texts: string[]): Promise<number[][]>;
}

export type RetrieverName = 'bm25' | 'vector';

export interface SearchResult {
  path: string;
  chunk_idx: number;
  snippet: string;
  frontmatter: Record<string, unknown>;
  score: number;
  retrievers: RetrieverName[];
  chunk_id: string;
  /**
   * Markdown heading hierarchy the chunk lives under, e.g.
   * `['Authentication', 'OAuth flow']`. Stored at chunk-time by the
   * indexer; consumed by `applyHeadingBoost` to score chunks under
   * relevant headings higher.
   */
  heading_path?: string[];
}

export interface QueryInput {
  query: string;
  intent?: string;
}

export interface QueryVariation {
  id: string;
  text: string;
  /**
   * Relative contribution within one planner output. The original query uses
   * weight 1; expansion variants are bounded by the engine before retrieval.
   */
  weight: number;
}

export interface QueryPlan {
  original: string;
  lexical: QueryVariation[];
  semantic: QueryVariation[];
}

export interface QueryPlanner {
  readonly id: string;
  plan(input: QueryInput): Promise<QueryPlan>;
}

export interface RankedList {
  retriever: RetrieverName;
  queryId: string;
  weight: number;
  results: SearchResult[];
}

export interface RankContribution {
  retriever: RetrieverName;
  query_id: string;
  rank: number;
  weight: number;
  rrf_contribution: number;
}

export interface RetrievalLimits {
  perRetrieverK: number;
  candidateK: number;
  finalK: number;
}

export interface RankingSignalTrace {
  chunk_id: string;
  retrieval_score: number;
  signaled_score: number;
  final_score: number;
  exact_match: boolean;
  path_match_fraction: number;
  heading_match_fraction: number;
  contributions: RankContribution[];
}

export interface SearchTimings {
  planner_ms: number;
  bm25_ms: number;
  embed_ms: number;
  vector_ms: number;
  candidate_retrieval_ms: number;
  fusion_ms: number;
  signals_ms: number;
  dedup_ms: number;
  rerank_ms: number;
  diversity_ms: number;
  query_ms: number;
}

export interface SearchTrace {
  query: {
    normalized: string;
    intent?: string;
  };
  planner: {
    id: string;
    lexical_variation_ids: string[];
    semantic_variation_ids: string[];
  };
  limits: RetrievalLimits;
  candidates: {
    by_retriever: Record<RetrieverName, number>;
    fused_count: number;
    deduplicated_count: number;
    before_rerank_ids: string[];
    after_rerank_ids: string[];
    final_ids: string[];
  };
  ranking: RankingSignalTrace[];
  timings: SearchTimings;
  fallback?: {
    stage: 'planner' | 'reranker';
    reason: string;
  };
}

export interface SearchQueryOptions {
  k?: number;
  debug?: boolean;
  trace?: boolean;
  mode?: 'fast' | 'enhanced';
}

export interface SearchEngine {
  query(
    q: string | QueryInput,
    opts?: SearchQueryOptions,
  ): Promise<{
    results: SearchResult[];
    query_ms: number;
    debug?: SearchTrace;
    trace?: SearchTrace;
  }>;
}

export interface RerankContext {
  intent?: string;
  mode: 'fast' | 'enhanced';
}

export interface RerankedResult extends SearchResult {
  retrievalScore: number;
  rerankerScore?: number;
  finalScore: number;
}

export interface Reranker {
  readonly id?: string;
  rerank(
    query: string,
    candidates: SearchResult[],
    context?: RerankContext,
  ): Promise<Array<SearchResult | RerankedResult>>;
}

export interface EvidenceAccessScope {
  scope_id?: string;
  scope_hash?: string;
}

export interface EvidencePassage {
  citation_id: string;
  source_id: string;
  chunk_id: string;
  path: string;
  canonical_url?: string;
  revision?: string;
  heading_path: string[];
  text: string;
  signals: {
    score: number;
    retrievers: RetrieverName[];
    retrieval_score?: number;
    reranker_score?: number;
  };
  access_scope?: EvidenceAccessScope;
  estimated_tokens: number;
}

export interface EvidenceConflict {
  id: string;
  passage_ids: string[];
  description: string;
}

export interface EvidencePackage {
  query: QueryInput;
  corpusVersion?: string;
  passages: EvidencePassage[];
  conflicts: EvidenceConflict[];
  gaps: string[];
  estimatedTokens: number;
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
  /** Per-page facts for the deterministic `remember doctor` corpus-health sweep. */
  collectDoctorFacts(): import('./doctor/doctor.js').DoctorPageFact[];
}

export interface RememberConfig {
  name?: string;
  description?: string;
  content?: string;
  server?: {
    host?: string;
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
  schemaVersion?: number;
}
