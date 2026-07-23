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
import { createHybridSearchEngine } from '../search/hybrid.js';
import { createPassthroughReranker } from '../rerankers/none.js';
import { createIndexer } from '../indexer/index.js';
import { loadConfig, type LoadedConfig } from '../config/load.js';
import { resolveEmbedder } from './resolve-embedder.js';
import { createConnectorManager } from '../connectors/manager.js';
import { resolveConnectors } from '../connectors/resolve.js';
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
  connectorManager: Awaited<ReturnType<typeof createConnectorManager>>;
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
  store.setDimension(embedder.dim);
  const reranker = createPassthroughReranker();
  const search = createHybridSearchEngine(store, embedder, reranker, { topK: 20, finalK: 10 });
  const indexer = createIndexer({ walker, parser, chunker, embedder, store });

  // Pre-warm the embedder so the one-time model download (~80 MB for the local
  // ONNX default) happens at boot with a visible log line, rather than silently
  // on a user's first search. Non-fatal: if it fails (e.g. offline), we log a
  // clear hint and let the retry happen on first real request — getPipeline()
  // no longer caches the failure, so recovery needs no restart.
  process.stdout.write(`[remember] warming embedder (${embedder.modelId ?? 'embedder'})…\n`);
  const warmStart = Date.now();
  try {
    await embedder.embed(['warmup']);
    process.stdout.write(`[remember] embedder ready in ${Date.now() - warmStart}ms\n`);
  } catch (err) {
    const msg = (err as Error).message;
    process.stderr.write(`[remember] embedder warm-up failed (will retry on first request): ${msg}\n`);
    logs.push({ level: 'warn', source: 'embedder', message: `warm-up failed: ${msg}` });
  }

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

  // Connectors.
  const resolvedConnectors = resolveConnectors(cfg.raw.connectors, cfg.rootDir);
  const connectorManager = await createConnectorManager({
    connectors: resolvedConnectors,
    contentRoot,
    rootDir: cfg.rootDir,
    events,
  });

  if (resolvedConnectors.length > 0) {
    process.stdout.write(
      `[remember] ${resolvedConnectors.length} connector(s) configured: ${resolvedConnectors.map((c) => c.name).join(', ')}\n`,
    );
    connectorManager
      .syncAll()
      .then((r) => {
        const summary = Object.entries(r)
          .map(([name, res]) => {
            if (res && typeof res === 'object' && 'error' in res)
              return `${name}: ERROR (${(res as { error: string }).error})`;
            const r2 = res as { files_written?: number; files_unchanged?: number; duration_ms?: number };
            return `${name}: ${r2.files_written ?? 0}w/${r2.files_unchanged ?? 0}u in ${r2.duration_ms ?? 0}ms`;
          })
          .join(' · ');
        process.stdout.write(`[remember] initial connector sync done — ${summary}\n`);
      })
      .catch((err) => {
        const msg = (err as Error).message;
        process.stderr.write(`[remember] connector sync failed: ${msg}\n`);
        logs.push({ level: 'error', source: 'connectors', message: `initial sync failed: ${msg}` });
      });
  }

  return {
    contentRoot,
    store,
    embedder,
    search,
    indexer,
    watcher,
    connectorManager,
    configSnapshot: cfg,
  };
}

async function teardownRuntime(rt: Runtime): Promise<void> {
  await rt.watcher.close().catch(() => undefined);
  await rt.connectorManager.stopAll().catch(() => undefined);
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

  const targetConfigPath = () => cfg.configPath ?? path.join(cfg.rootDir, 'remember.config.ts');

  // Hot-reload: rebuild the runtime from disk config, swap atomically.
  // Returns ok:true on success, ok:false with the error if the new config
  // fails to load or build — the old runtime stays in place in that case.
  const reloadConfig = async (): Promise<
    | { ok: true; reloaded_at: string }
    | { ok: false; error: { code: string; message: string; hint?: string } }
  > => {
    let newCfg: LoadedConfig;
    try {
      newCfg = await loadConfig(opts.rootDir);
    } catch (err) {
      const msg = (err as Error).message;
      logs.push({ level: 'error', source: 'config', message: `reload failed (load): ${msg}` });
      return {
        ok: false as const,
        error: {
          code: 'CONFIG_LOAD_FAILED',
          message: `Failed to load new config: ${msg}`,
          hint: 'Check the saved remember.config.ts for syntax or schema errors',
        },
      };
    }

    let newRuntime: Runtime;
    try {
      newRuntime = await buildRuntime({ rootDir: opts.rootDir, events, cfg: newCfg, logs });
    } catch (err) {
      const msg = (err as Error).message;
      logs.push({ level: 'error', source: 'config', message: `reload failed (build): ${msg}` });
      return {
        ok: false as const,
        error: {
          code: 'PIPELINE_BUILD_FAILED',
          message: `Failed to build pipeline from new config: ${msg}`,
          hint: 'Embedder, store, or connector init failed — check the error message',
        },
      };
    }

    const old = runtime;
    runtime = newRuntime;
    cfg = newCfg;

    // Mutate ctx fields so existing route closures see the new pipeline.
    ctx.contentRoot = newRuntime.contentRoot;
    ctx.store = newRuntime.store;
    ctx.embedder = newRuntime.embedder;
    ctx.search = newRuntime.search;
    ctx.adminToken = newCfg.validated.server.adminToken;
    ctx.boundHost = newCfg.validated.server.host;
    ctx.remoteAllowed = newCfg.validated.server.host !== '127.0.0.1';
    ctx.configPath = newCfg.configPath;
    ctx.configRoot = newCfg.rootDir;

    await teardownRuntime(old);

    // Kick off an initial index against the new pipeline so the store is
    // populated under the new embedder dim.
    newRuntime.indexer.indexAll(newRuntime.contentRoot).catch((err) => {
      process.stderr.write(`[remember] post-reload index failed: ${(err as Error).message}\n`);
    });

    const reloadedAt = new Date().toISOString();
    events.emit('event', { type: 'config.reloaded', at: reloadedAt });
    logs.push({ level: 'info', source: 'config', message: 'hot-reload applied' });
    return { ok: true as const, reloaded_at: reloadedAt };
  };

  // Build the route context. Fields that point at runtime are reassigned on
  // reload above — route handlers read ctx fields on every request, so they
  // pick up the swap automatically.
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
    remoteAllowed: cfg.validated.server.host !== '127.0.0.1',
    configPath: cfg.configPath,
    configRoot: cfg.rootDir,
    getConfig: () => ({
      name: cfg.raw.name,
      description: cfg.raw.description,
      content: cfg.validated.content,
      server: cfg.validated.server,
      viewer: cfg.validated.viewer,
      schemaVersion: cfg.validated.schemaVersion,
    }),
    saveConfig: async (source: string) => {
      if (!/defineConfig\s*\(/.test(source)) {
        return {
          ok: false as const,
          error: {
            code: 'CONFIG_INVALID',
            message: 'Source does not contain a `defineConfig(...)` call.',
            hint: 'Use /admin/setup to generate a valid config, or paste one that calls defineConfig.',
          },
        };
      }

      const target = targetConfigPath();
      let backupPath: string | null = null;
      try {
        await fs.access(target);
        backupPath = `${target}.bak.${Date.now()}`;
        await fs.copyFile(target, backupPath);
      } catch {
        /* file doesn't exist — skip backup */
      }

      try {
        await fs.writeFile(target, source, 'utf8');
      } catch (err) {
        return {
          ok: false as const,
          error: {
            code: 'WRITE_FAILED',
            message: `Failed to write ${target}: ${(err as Error).message}`,
          },
        };
      }

      return { ok: true as const, written_to: target, backup_path: backupPath };
    },
    reloadConfig,
    logs,
    history: {
      append: (e: HistoryWriteInput) => runtime.store.appendHistory(e),
      list: (p: string, l?: number) => runtime.store.listHistory(p, l),
      get: (id: number) => runtime.store.getHistoryEntry(id),
      prune: (p: string, keep?: number) => runtime.store.pruneHistory(p, keep),
    },
    events,
    connectors: {
      list: () => runtime.connectorManager.list(),
      syncOne: (name: string) => runtime.connectorManager.syncOne(name),
      syncAll: () => runtime.connectorManager.syncAll(),
    },
  };

  const app = createApp(ctx);

  const port = cfg.validated.server.apiPort;
  const host = cfg.validated.server.host;

  if (host !== '127.0.0.1' && !cfg.validated.server.adminToken) {
    throw new Error(
      `Cowardly refusing to bind to ${host} without REMEMBER_ADMIN_TOKEN set. Set the env var or use --host 127.0.0.1.`,
    );
  }

  const server = serve({ fetch: app.fetch, hostname: host, port });
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>(async (resolve) => {
        await teardownRuntime(runtime).catch(() => undefined);
        server.close(() => resolve());
      }),
  };
}
