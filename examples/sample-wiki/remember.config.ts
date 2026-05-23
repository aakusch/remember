import { defineConfig, defaults } from '@remember/core';

export default defineConfig({
  name: 'Sample Wiki',
  description: 'Example knowledge base shipped with remember',
  content: './content',

  pipeline: {
    walker: defaults.walker.chokidar({ respectGitignore: true }),
    parser: defaults.parser.remark(),
    chunker: defaults.chunker.smartSplit({ size: 900, overlap: 0.15 }),
    embedder: defaults.embedder.localOnnx({ model: 'BAAI/bge-small-en-v1.5' }),
    store: defaults.store.sqliteVec({ path: '.remember/index.db' }),
  },

  search: {
    engine: defaults.search.hybrid({
      bm25: { enabled: true, weight: 0.5 },
      vector: { enabled: true, weight: 0.5 },
      fusion: 'rrf',
      rerank: defaults.rerank.none(),
      topK: 20,
      finalK: 10,
    }),
  },

  schemaVersion: 1,
});
