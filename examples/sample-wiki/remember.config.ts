import { defineConfig, defaults } from '@remember/core';

export default defineConfig({
  name: 'Sample Wiki',
  description: 'Example knowledge base shipped with remember',

  content: './content',

  server: {
    host: '127.0.0.1',
    apiPort: 4320,
    port: 4321,
  },

  pipeline: {
    walker:   defaults.walker.chokidar({ respectGitignore: true }),
    parser:   defaults.parser.remark(),
    chunker:  defaults.chunker.smartSplit({ size: 900, overlap: 0.15 }),
    embedder: defaults.embedder.localOnnx({ model: 'BAAI/bge-small-en-v1.5' }),
    store:    defaults.store.sqliteVec({ path: '.remember/index.db' }),
  },

  search: {
    engine: defaults.search.hybrid({
      bm25:   { enabled: true, weight: 0.5 },
      vector: { enabled: true, weight: 0.5 },
      fusion: 'rrf',
      rerank: defaults.rerank.none(),
      topK: 20,
      finalK: 10,
    }),
  },

  viewer: {
    landing: 'README.md',
    showAdmin: true,
    breadcrumbs: true,
  },

  // Pull external content into the index via connectors.
  // Synced files land in content/_<connector-name>/ and flow through the same
  // pipeline as your hand-written pages.
  connectors: [
    defaults.connector.obsidian({
      name: 'obsidian',
      vaultPath: '../sample-vault',
      transformWikilinks: true,
      tag: 'obsidian',
    }),
    defaults.connector.granola({
      name: 'granola',
      // No apiUrl/apiKey here — connector reports as "misconfigured" until you
      // wire it up. To enable, set GRANOLA_API_URL + GRANOLA_API_KEY env vars
      // or pass a fetchMeetings callback in code.
      apiUrl: process.env.GRANOLA_API_URL,
      apiKey: process.env.GRANOLA_API_KEY,
      since: '2026-01-01',
      tag: 'meeting',
      includeTranscript: false,
    }),
  ],

  schemaVersion: 1,
});
