export { defineConfig } from './config/index.js';
export * as defaults from './config/defaults.js';
export { loadConfig } from './config/load.js';
export type { ValidatedConfig } from './config/schema.js';

export type {
  Walker,
  Parser,
  Chunker,
  Chunk,
  Embedder,
  Store,
  SearchEngine,
  SearchResult,
  SearchQueryOptions,
  SearchTrace,
  SearchTimings,
  QueryInput,
  QueryPlan,
  QueryPlanner,
  QueryVariation,
  RankedList,
  RankContribution,
  RankingSignalTrace,
  RetrievalLimits,
  RetrieverName,
  Reranker,
  RerankedResult,
  RerankContext,
  EvidenceAccessScope,
  EvidenceConflict,
  EvidencePackage,
  EvidencePassage,
  RememberConfig,
  PageRecord,
  PageQuery,
  DocumentParser,
  ParsedDocument,
  WalkEntry,
} from './types.js';
export { isDocumentParser } from './types.js';

export { createApp } from './api/server.js';
export { startServer } from './api/start-server.js';

export { createFsWalker } from './walkers/fs-walker.js';
export { createRemarkParser } from './parsers/remark.js';
export {
  createFormatRouter,
  SUPPORTED_FORMATS,
  type FormatName,
  type FormatRouter,
  type FormatRouterOptions,
} from './parsers/format-router.js';
export { createPdfDocumentParser, type PdfParserOptions } from './parsers/pdf.js';
export {
  createAnydocDocumentParser,
  normalizeAnydocMarkdown,
  ANYDOC_FORMAT_EXTENSIONS,
  ANYDOC_FORMAT_NAMES,
  type AnydocFormatName,
  type AnydocParserOptions,
} from './parsers/anydoc.js';
export { createSmartSplitChunker } from './chunkers/smart-split.js';
export { createSqliteVecStore } from './stores/sqlite-vec.js';
export { createHybridSearchEngine } from './search/hybrid.js';
export {
  rrfFuse,
  rrfFuseWithTrace,
  type RrfFusionResult,
  type RrfOptions,
} from './search/rrf.js';
export {
  createEvidencePackage,
  estimateTokens,
  type EvidenceCandidate,
  type EvidencePackageOptions,
} from './search/evidence.js';
export { extractSnippet, extractAnswer, tokenizeQuery, splitSentences } from './search/snippet.js';
export {
  buildCapabilities,
  JSON_SCHEMA_VERSION,
  CAPABILITY_ENDPOINTS,
  CAPABILITY_COMMANDS,
  type Capabilities,
  type CapabilityEndpoint,
  type CapabilityCommand,
} from './capabilities.js';
export { createNoneReranker } from './rerankers/none.js';
export {
  createPassthroughQueryPlanner,
  passthroughQueryPlan,
} from './query-planners/passthrough.js';
export { createIndexer } from './indexer/index.js';
export { createHashEmbedder } from './embedders/hash.js';
export { createLocalOnnxEmbedder } from './embedders/local-onnx.js';
export { createOpenAIEmbedder } from './embedders/openai.js';
export * from './evaluation/index.js';
