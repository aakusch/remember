import { serve } from '@hono/node-server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createApp } from './server.js';
import { createSqliteVecStore } from '../stores/sqlite-vec.js';
import { createChokidarWalker } from '../walkers/chokidar.js';
import { createRemarkParser } from '../parsers/remark.js';
import { createSmartSplitChunker } from '../chunkers/smart-split.js';
import { createHybridSearchEngine } from '../search/hybrid.js';
import { createPassthroughReranker } from '../rerankers/none.js';
import { createIndexer } from '../indexer/index.js';
import { loadConfig } from '../config/load.js';
import { resolveEmbedder } from './resolve-embedder.js';

export interface StartServerOptions {
  rootDir: string;
}

export async function startServer(opts: StartServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const cfg = await loadConfig(opts.rootDir);
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);

  const walker = createChokidarWalker({ respectGitignore: true });
  const parser = createRemarkParser();
  const chunker = createSmartSplitChunker({ size: 900, overlap: 0.15 });
  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({ path: path.join(cfg.rootDir, '.remember', 'index.db'), dim: embedder.dim });
  store.setDimension(embedder.dim);
  const reranker = createPassthroughReranker();
  const search = createHybridSearchEngine(store, embedder, reranker, { topK: 20, finalK: 10 });

  const indexer = createIndexer({ walker, parser, chunker, embedder, store });

  const reindex = async (mode: 'incremental' | 'full') => {
    if (mode === 'full') {
      // For full reindex, we'd want to clear the manifest first.
      // For v1, we let incremental + manifest do the right thing.
    }
    const result = await indexer.indexAll(contentRoot);
    return {
      files_indexed: result.files_indexed,
      chunks_added: result.chunks_added,
      duration_ms: result.duration_ms,
    };
  };

  const targetConfigPath = cfg.configPath ?? path.join(cfg.rootDir, 'remember.config.ts');

  const app = createApp({
    contentRoot,
    store,
    embedder,
    search,
    reindex,
    adminToken: cfg.validated.server.adminToken,
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
      // Sanity check: the source must contain a defineConfig call.
      if (!/defineConfig\s*\(/.test(source)) {
        return {
          ok: false as const,
          error: {
            code: 'CONFIG_INVALID',
            message: 'Source does not contain a `defineConfig(...)` call.',
            hint: 'Use the /admin/setup wizard to generate a valid config, or paste a hand-written one that calls defineConfig.',
          },
        };
      }

      // Backup the existing file if present.
      let backupPath: string | null = null;
      try {
        await fs.access(targetConfigPath);
        backupPath = `${targetConfigPath}.bak.${Date.now()}`;
        await fs.copyFile(targetConfigPath, backupPath);
      } catch {
        // File doesn't exist — skip backup.
      }

      try {
        await fs.writeFile(targetConfigPath, source, 'utf8');
      } catch (err) {
        return {
          ok: false as const,
          error: {
            code: 'WRITE_FAILED',
            message: `Failed to write ${targetConfigPath}: ${(err as Error).message}`,
          },
        };
      }

      return { ok: true as const, written_to: targetConfigPath, backup_path: backupPath };
    },
  });

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
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        store.close();
      }),
  };
}
