import path from 'node:path';
import { loadConfig, type LoadedConfig } from '../config/load.js';
import { requireWiki } from '../cli/require-wiki.js';
import { createSqliteVecStore, type SqliteVecStore } from '../stores/sqlite-vec.js';
import { resolveEmbedder } from './resolve-embedder.js';
import { createHybridSearchEngine, type HybridSearchOptions } from '../search/hybrid.js';
import { createPassthroughReranker } from '../rerankers/none.js';
import { createIndexer } from '../indexer/index.js';
import { createChokidarWalker } from '../walkers/chokidar.js';
import { createRemarkParser } from '../parsers/remark.js';
import { createSmartSplitChunker } from '../chunkers/smart-split.js';
import type { Embedder } from '../types.js';

/** Unwrap a `defaults.search.hybrid({...})` descriptor to its options. */
export function resolveHybridSearchOptions(descriptor: unknown): HybridSearchOptions {
  if (
    descriptor &&
    typeof descriptor === 'object' &&
    (descriptor as { _kind?: unknown })._kind === 'search:hybrid'
  ) {
    const options = (descriptor as { opts?: unknown }).opts;
    return options && typeof options === 'object' ? (options as HybridSearchOptions) : {};
  }
  return {};
}

export interface OpenWiki {
  cfg: LoadedConfig;
  contentRoot: string;
  store: SqliteVecStore;
  embedder: Embedder;
  engine: ReturnType<typeof createHybridSearchEngine>;
  indexer: ReturnType<typeof createIndexer>;
}

/**
 * Open the wiki in `rootDir` and build the full read/write pipeline — config,
 * embedder, store (with embedder reconciliation), hybrid search engine, and
 * indexer. The single place that assembles these, so `search`, `mcp`, and any
 * other command share identical wiring instead of copy-pasting it.
 */
export async function openWiki(rootDir: string): Promise<OpenWiki> {
  const cfg = await loadConfig(rootDir);
  await requireWiki(cfg);
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);
  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });
  const reconcile = store.reconcileEmbedder(embedder.modelId, embedder.dim);
  if (reconcile.changed) {
    process.stderr.write(
      `remember: index was built with a different embedder (${reconcile.previousModelId}) and was cleared — run \`remember index\` to rebuild with ${embedder.modelId}.\n`,
    );
  }
  const engine = createHybridSearchEngine(
    store,
    embedder,
    createPassthroughReranker(),
    resolveHybridSearchOptions(cfg.raw.search?.engine),
  );
  const indexer = createIndexer({
    walker: createChokidarWalker({ respectGitignore: true }),
    parser: createRemarkParser(),
    chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
    embedder,
    store,
  });
  return { cfg, contentRoot, store, embedder, engine, indexer };
}
