import { serve } from '@hono/node-server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { EventEmitter } from 'node:events';
import chokidar from 'chokidar';
import { createApp } from './server.js';
import { createSqliteVecStore, type SqliteVecStore, type HistoryWriteInput } from '../stores/sqlite-vec.js';
import { createHybridSearchEngine, type HybridSearchOptions } from '../search/hybrid.js';
import { createNoneReranker } from '../rerankers/none.js';
import { createIndexer } from '../indexer/index.js';
import { createDefaultIndexer } from './open-wiki.js';
import { loadConfig, type LoadedConfig } from '../config/load.js';
import { resolveEmbedder } from './resolve-embedder.js';
import { createLogBuffer, type LogBuffer } from '../observability/log-buffer.js';
import type { Embedder, SearchEngine } from '../types.js';

export interface StartServerOptions {
  rootDir: string;
  /**
   * Run a full index pass before the server begins serving, and return the
   * stats. `remember dev` sets this so the model is loaded (and the corpus
   * indexed) exactly once at startup — previously dev built its own
   * store+embedder+indexer for the initial pass and then startServer built a
   * second set, loading the ONNX model twice.
   */
  initialIndex?: boolean;
  /**
   * Build the index on boot *only when it is empty*. `remember start` is the
   * Docker CMD, and it used to serve an empty index in silence: a fresh container
   * answered every query with zero results until someone thought to POST
   * /v1/index. "Assumes the index is already built" is a fair contract for a
   * local run and a trap for a container. A populated index is never touched.
   */
  indexIfEmpty?: boolean;
}

export interface IndexPassResult {
  files_indexed: number;
  chunks_added: number;
  duration_ms: number;
  errors: { path: string; error: string }[];
}

export interface StartedServer {
  url: string;
  close: () => Promise<void>;
  /** The embedder the server bound, so callers can report it without re-resolving. */
  embedder: { modelId: string; dim: number };
  /** Present when `initialIndex` was requested. */
  index?: IndexPassResult;
  /** True when `indexIfEmpty` found an empty index and built it. */
  indexedOnBoot?: boolean;
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
  const reranker = createNoneReranker();
  const search = createHybridSearchEngine(
    store,
    embedder,
    reranker,
    resolveHybridSearchOptions(cfg.raw.search?.engine),
  );
  const indexer = createDefaultIndexer(store, embedder, cfg.validated.index.formats);

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

  // Reindex only the files that actually changed — not the whole corpus. The
  // previous indexAll() re-walked + re-hashed every .md on every keystroke-save
  // (O(corpus) per change); indexOne is O(1) per change and keeps `remember dev`
  // fast on a real wiki. Pending ops are coalesced by the debounce.
  const pending = new Map<string, 'upsert' | 'delete'>();
  let reindexTimer: ReturnType<typeof setTimeout> | null = null;
  const flushPending = async () => {
    const batch = [...pending];
    pending.clear();
    for (const [rel, op] of batch) {
      try {
        if (op === 'delete') {
          await store.deleteByPath(rel);
          await store.deletePage(rel);
          await store.updateManifest(rel, null);
        } else {
          await indexer.indexOne(contentRoot, rel);
        }
      } catch (err) {
        const msg = (err as Error).message;
        process.stderr.write(`[remember] watcher reindex failed for ${rel}: ${msg}\n`);
        logs.push({ level: 'error', source: 'indexer', message: `watcher reindex failed for ${rel}: ${msg}` });
      }
    }
  };
  const scheduleReindex = () => {
    if (reindexTimer) clearTimeout(reindexTimer);
    reindexTimer = setTimeout(() => {
      reindexTimer = null;
      void flushPending();
    }, 500);
  };
  const emitChange = (event: 'add' | 'change' | 'unlink', absPath: string) => {
    const rel = path.relative(contentRoot, absPath).split(path.sep).join('/');
    pending.set(rel, event === 'unlink' ? 'delete' : 'upsert');
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

export async function startServer(opts: StartServerOptions): Promise<StartedServer> {
  const events = new EventEmitter();
  const logs = createLogBuffer(50);

  // Build initial runtime from disk config.
  let cfg = await loadConfig(opts.rootDir);
  let runtime = await buildRuntime({ rootDir: opts.rootDir, events, cfg, logs });

  // Optional startup index pass, using the runtime's already-loaded embedder.
  let indexedOnBoot = false;
  if (!opts.initialIndex && opts.indexIfEmpty) {
    const manifest = await runtime.store.getManifest();
    if (Object.keys(manifest).length === 0) {
      events.emit('event', { type: 'index.started', mode: 'full' });
      const r = await runtime.indexer.indexAll(runtime.contentRoot);
      events.emit('event', { type: 'index.completed', mode: 'full', ...r });
      indexedOnBoot = true;
    }
  }

  let initialIndex: IndexPassResult | undefined;
  if (opts.initialIndex) {
    events.emit('event', { type: 'index.started', mode: 'full' });
    const r = await runtime.indexer.indexAll(runtime.contentRoot);
    events.emit('event', { type: 'index.completed', mode: 'full', ...r });
    initialIndex = {
      files_indexed: r.files_indexed,
      chunks_added: r.chunks_added,
      duration_ms: r.duration_ms,
      errors: r.errors,
    };
  }

  logs.push({ level: 'info', source: 'server', message: 'startup complete' });

  // Build the route context. Route handlers read ctx fields on every request.
  const ctx = {
    contentRoot: runtime.contentRoot,
    store: runtime.store,
    embedder: runtime.embedder,
    search: runtime.search,
    reindex: async (mode: 'incremental' | 'full') => {
      events.emit('event', { type: 'index.started', mode });
      // `full` has to mean something. indexAll skips any file whose sha256 still
      // matches the manifest, so without dropping the manifest first a "full"
      // rebuild was byte-identical to an incremental one — the mode was accepted,
      // documented in the OpenAPI spec, echoed back in the event, and did nothing.
      //
      // It is also the only recovery path that exists: swap the embedder and every
      // stored vector belongs to the old model, but every sha256 still matches, so
      // an incremental pass re-embeds nothing and search stays quietly broken.
      if (mode === 'full') {
        const manifest = await runtime.store.getManifest();
        for (const sourcePath of Object.keys(manifest)) {
          await runtime.store.updateManifest(sourcePath, null);
        }
      }
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
    embedder: { modelId: runtime.embedder.modelId, dim: runtime.embedder.dim },
    index: initialIndex,
    indexedOnBoot,
    close: () =>
      new Promise<void>(async (resolve) => {
        await teardownRuntime(runtime).catch(() => undefined);
        server.close(() => resolve());
      }),
  };
}
