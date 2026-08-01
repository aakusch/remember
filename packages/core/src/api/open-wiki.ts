import path from 'node:path';
import { loadConfig, type LoadedConfig } from '../config/load.js';
import { requireWiki } from '../cli/require-wiki.js';
import { createSqliteVecStore, type SqliteVecStore } from '../stores/sqlite-vec.js';
import { resolveEmbedder } from './resolve-embedder.js';
import { createHybridSearchEngine, type HybridSearchOptions } from '../search/hybrid.js';
import { createNoneReranker } from '../rerankers/none.js';
import { createIndexer } from '../indexer/index.js';
import { createFsWalker } from '../walkers/fs-walker.js';
import { createRemarkParser } from '../parsers/remark.js';
import { createSmartSplitChunker } from '../chunkers/smart-split.js';
import type { Embedder, Store } from '../types.js';

/**
 * Default chunking parameters, centralized in ONE place. `maxSize` is an absolute
 * ceiling in tokens; the effective chunk size is capped further to the embedder's
 * own input window (see chunkSizeFor) so a chunk's vector is never built from only
 * the first N tokens of a too-large chunk. The 0.85 factor leaves headroom for the
 * 15% overlap + the heading prefix so an overlapped chunk still fits.
 */
export const DEFAULT_CHUNK = { maxSize: 512, overlap: 0.15 } as const;

/** Effective chunk size (tokens) for an embedder: the smaller of the default
 *  ceiling and 85% of the model's input window. */
export function chunkSizeFor(embedder: Embedder): number {
  return Math.min(DEFAULT_CHUNK.maxSize, Math.floor(embedder.maxInputTokens * 0.85));
}

/** Build the standard indexer (fs walker + remark parser + smart-split
 *  chunker) for a store+embedder. The single source of the pipeline wiring. */
export function createDefaultIndexer(store: Store, embedder: Embedder) {
  return createIndexer({
    walker: createFsWalker({ respectGitignore: true }),
    parser: createRemarkParser(),
    chunker: createSmartSplitChunker({ size: chunkSizeFor(embedder), overlap: DEFAULT_CHUNK.overlap }),
    embedder,
    store,
  });
}

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
    createNoneReranker(),
    resolveHybridSearchOptions(cfg.raw.search?.engine),
  );
  const indexer = createDefaultIndexer(store, embedder);
  return { cfg, contentRoot, store, embedder, engine, indexer };
}
