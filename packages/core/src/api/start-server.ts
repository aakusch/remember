import { serve } from '@hono/node-server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { EventEmitter } from 'node:events';
import chokidar from 'chokidar';
import { createApp } from './server.js';
import { createSqliteVecStore, type SqliteVecStore, type HistoryWriteInput } from '../stores/sqlite-vec.js';
import { createChokidarWalker } from '../walkers/chokidar.js';
import { createRemarkParser } from '../parsers/remark.js';
import { createSmartSplitChunker } from '../chunkers/smart-split.js';
import { createHybridSearchEngine, type HybridSearchOptions } from '../search/hybrid.js';
import { createPassthroughReranker } from '../rerankers/none.js';
import { createIndexer } from '../indexer/index.js';
import { loadConfig, type LoadedConfig } from '../config/load.js';
import { resolveEmbedder } from './resolve-embedder.js';
import { createLogBuffer, type LogBuffer } from '../observability/log-buffer.js';
import type { Embedder, SearchEngine } from '../types.js';

export interface StartServerOptions {
  rootDir: string;
}

interface Runtime {
  contentRoot: string;
  store: SqliteVecStore;
  embedder: Embedder;
  search: SearchEngine;
  indexer: ReturnType<typeof createIndexer>;
  watcher: ReturnType<typeof chokidar.watch>;
  configSnapshot: LoadedConfig;
}

async function buildRuntime(opts: { rootDir: string; events: EventEmitter; cfg: LoadedConfig; logs: LogBuffer }): Promise<Runtime> {
  const { cfg, events, logs } = opts;
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);

  const walker = createChokidarWalker({ respectGitignore: true });
  const parser = createRemarkParser();
  const chunker = createSmartSplitChunker({ size: 900, overlap: 0.15 });
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
  const reranker = createPassthroughReranker();
  const search = createHybridSearchEngine(
    store,
    embedder,
    reranker,
    resolveHybridSearchOptions(cfg.raw.search?.engine),
  );
  const indexer = createIndexer({ walker, parser, chunker, embedder, store });

  // Filesystem watcher — debounced auto-reindex on disk changes.
  const watcher = chokidar.watch(contentRoot, {
    ignored: [
      /(^|[\\/])\.[^.]/,
      '**/node_modules/**',
      '**/.remember/**',
      '**/.git/**',
    ],
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
  });

  let reindexTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleReindex = () => {
    if (reindexTimer) clearTimeout(reindexTimer);
    reindexTimer = setTimeout(() => {
      reindexTimer = null;
      indexer.indexAll(contentRoot).catch((err) => {
        const msg = (err as Error).message;
        process.stderr.write(`[remember] watcher reindex failed: ${msg}\n`);
        logs.push({ level: 'error', source: 'indexer', message: `watcher reindex failed: ${msg}` });
      });
    }, 500);
  };
  const emitChange = (event: 'add' | 'change' | 'unlink', absPath: string) => {
    const rel = path.relative(contentRoot, absPath).split(path.sep).join('/');
    events.emit('event', { type: 'page.changed', kind: event, path: rel });
    scheduleReindex();
  };
  watcher.on('add', (p) => emitChange('add', p));
  watcher.on('change', (p) => emitChange('change', p));
  watcher.on('unlink', (p) => emitChange('unlink', p));

  return {
    contentRoot,
    store,
    embedder,
    search,
    indexer,
    watcher,
    configSnapshot: cfg,
  };
}

function resolveHybridSearchOptions(descriptor: unknown): HybridSearchOptions {
  if (
    descriptor &&
    typeof descriptor === 'object' &&
    (descriptor as { _kind?: unknown })._kind === 'search:hybrid'
  ) {
    const options = (descriptor as { opts?: unknown }).opts;
    return options && typeof options === 'object'
      ? (options as HybridSearchOptions)
      : {};
  }
  return {};
}

async function teardownRuntime(rt: Runtime): Promise<void> {
  await rt.watcher.close().catch(() => undefined);
  try {
    rt.store.close();
  } catch {
    /* swallow — already closed */
  }
}

export async function startServer(opts: StartServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const events = new EventEmitter();
  const logs = createLogBuffer(50);

  // Build initial runtime from disk config.
  let cfg = await loadConfig(opts.rootDir);
  let runtime = await buildRuntime({ rootDir: opts.rootDir, events, cfg, logs });

  logs.push({ level: 'info', source: 'server', message: 'startup complete' });

  // Build the route context. Route handlers read ctx fields on every request.
  const ctx = {
    contentRoot: runtime.contentRoot,
    store: runtime.store,
    embedder: runtime.embedder,
    search: runtime.search,
    reindex: async (mode: 'incremental' | 'full') => {
      events.emit('event', { type: 'index.started', mode });
      const result = await runtime.indexer.indexAll(runtime.contentRoot);
      events.emit('event', { type: 'index.completed', mode, ...result });
      return {
        files_indexed: result.files_indexed,
        chunks_added: result.chunks_added,
        duration_ms: result.duration_ms,
      };
    },
    reindexOne: async (relPath: string) => {
      events.emit('event', { type: 'index.started', mode: 'single', path: relPath });
      const r = await runtime.indexer.indexOne(runtime.contentRoot, relPath);
      events.emit('event', { type: 'index.completed', mode: 'single', path: relPath, chunks: r.chunks_added });
      return r;
    },
    adminToken: cfg.validated.server.adminToken,
    // Authoritative bind host — local-trust derives from this + the real peer
    // socket, never the client Host header.
    boundHost: cfg.validated.server.host,
    configPath: cfg.configPath,
    configRoot: cfg.rootDir,
    getConfig: () => ({
      name: cfg.raw.name,
      description: cfg.raw.description,
      content: cfg.validated.content,
      server: cfg.validated.server,
      schemaVersion: cfg.validated.schemaVersion,
    }),
    logs,
    history: {
      append: (e: HistoryWriteInput) => runtime.store.appendHistory(e),
      list: (p: string, l?: number) => runtime.store.listHistory(p, l),
      get: (id: number) => runtime.store.getHistoryEntry(id),
      prune: (p: string, keep?: number) => runtime.store.pruneHistory(p, keep),
    },
    events,
  };

  const app = createApp(ctx);

  const port = cfg.validated.server.apiPort;
  const host = cfg.validated.server.host;

  if (host !== '127.0.0.1' && !cfg.validated.server.adminToken) {
    throw new Error(
      `Cowardly refusing to bind to ${host} without REMEMBER_ADMIN_TOKEN set. Set the env var or use --host 127.0.0.1.`,
    );
  }

  // Await the actual bind before returning, and translate EADDRINUSE. Previously
  // serve() was fire-and-forget: startServer resolved, the CLI printed its full
  // "API is up, press Ctrl+C" banner, and THEN the bind failed with a raw
  // unhandled Node 'error' stack trace — the worst possible first-run failure.
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, hostname: host, port }, () => {
      s.off('error', onError);
      resolve(s);
    });
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `port ${port} is already in use — stop the other instance or set REMEMBER_API_PORT=<other>`,
          ),
        );
      } else {
        reject(err);
      }
    };
    s.on('error', onError);
  });
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>(async (resolve) => {
        await teardownRuntime(runtime).catch(() => undefined);
        server.close(() => resolve());
      }),
  };
}
