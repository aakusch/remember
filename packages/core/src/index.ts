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
} from './types.js';

export { createApp } from './api/server.js';
export { startServer } from './api/start-server.js';

export { createChokidarWalker } from './walkers/chokidar.js';
export { createRemarkParser } from './parsers/remark.js';
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
export { createPassthroughReranker } from './rerankers/none.js';
export {
  createCrossEncoderReranker,
  type CrossEncoderRerankerOptions,
} from './rerankers/cross-encoder.js';
export {
  createPassthroughQueryPlanner,
  passthroughQueryPlan,
} from './query-planners/passthrough.js';
export { createIndexer } from './indexer/index.js';
export { createHashEmbedder } from './embedders/hash.js';
export { createLocalOnnxEmbedder } from './embedders/local-onnx.js';
export { createOpenAIEmbedder } from './embedders/openai.js';
export * from './evaluation/index.js';

export {
  createConnectorManager,
  createObsidianConnector,
  createGranolaConnector,
  createFilesystemConnector,
  resolveConnectors,
  type Connector,
  type ConnectorManager,
  type ConnectorStatus,
  type ConnectorSyncResult,
  type ObsidianConnectorOptions,
  type GranolaConnectorOptions,
  type GranolaMeeting,
  type FilesystemConnectorOptions,
} from './connectors/index.js';
