import { defineConfig, defaults } from '@useremember/core';

export default defineConfig({
  name: 'Sample Wiki',
  description: 'Example knowledge base shipped with remember',

  content: './content',

  server: {
    host: '127.0.0.1',
    apiPort: 4320,
  },

  pipeline: {
    walker:   defaults.walker.fs({ respectGitignore: true }),
    parser:   defaults.parser.remark(),
    // `size` is a token budget capped to the embedder's real input limit
    // (bge-small = 512). Take the default rather than restating a larger number
    // that would over-promise what the chunker actually does.
    chunker:  defaults.chunker.smartSplit({ overlap: 0.15 }),
    embedder: defaults.embedder.localOnnx({ model: 'BAAI/bge-small-en-v1.5' }),
    store:    defaults.store.sqliteVec({ path: '.remember/index.db' }),
  },

  search: {
    engine: defaults.search.hybrid({
      bm25:   { enabled: true, weight: 0.5 },
      vector: { enabled: true, weight: 0.5 },
      fusion: 'rrf',
      rerank: defaults.rerank.none(),
      limits: {
        perRetrieverK: 30,
        candidateK: 30,
        finalK: 10,
      },
    }),
  },

  // There are no built-in connectors. Ingestion is deliberately not the
  // engine's job: the wiki is plain Markdown, so your agent (or you) writes
  // Markdown into content/ — pulling from Obsidian, exports, or anywhere else.
  // See content/remember.md, "bring content in", for the agent-as-connector
  // pattern.

  schemaVersion: 1,
});
