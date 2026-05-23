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
  Reranker,
  RememberConfig,
} from './types.js';

export { createApp } from './api/server.js';
export { startServer } from './api/start-server.js';

export { createChokidarWalker } from './walkers/chokidar.js';
export { createRemarkParser } from './parsers/remark.js';
export { createSmartSplitChunker } from './chunkers/smart-split.js';
export { createSqliteVecStore } from './stores/sqlite-vec.js';
export { createHybridSearchEngine } from './search/hybrid.js';
export { rrfFuse } from './search/rrf.js';
export { createPassthroughReranker } from './rerankers/none.js';
export { createIndexer } from './indexer/index.js';
export { createHashEmbedder } from './embedders/hash.js';
export { createLocalOnnxEmbedder } from './embedders/local-onnx.js';
export { createOpenAIEmbedder } from './embedders/openai.js';
