import path from 'node:path';
import { startServer } from '../../api/start-server.js';
import { loadConfig } from '../../config/load.js';
import { createChokidarWalker } from '../../walkers/chokidar.js';
import { createRemarkParser } from '../../parsers/remark.js';
import { createSmartSplitChunker } from '../../chunkers/smart-split.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { createIndexer } from '../../indexer/index.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { startViewer, type ViewerHandle } from '../start-viewer.js';

export async function devCommand(): Promise<void> {
  const cfg = await loadConfig(process.cwd());
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);

  process.stdout.write(`remember dev: indexing ${contentRoot}\n`);

  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });
  store.setDimension(embedder.dim);

  const indexer = createIndexer({
    walker: createChokidarWalker({ respectGitignore: true }),
    parser: createRemarkParser(),
    chunker: createSmartSplitChunker({ size: 900, overlap: 0.15 }),
    embedder,
    store,
  });

  const initial = await indexer.indexAll(contentRoot);
  process.stdout.write(
    `  initial index: ${initial.files_indexed} files / ${initial.chunks_added} chunks in ${initial.duration_ms}ms\n`,
  );
  store.close();

  const { url: apiUrl, close: stopApi } = await startServer({ rootDir: process.cwd() });
  process.stdout.write(`\nremember dev: API listening at ${apiUrl}\n`);
  process.stdout.write(`  Health:  ${apiUrl}/v1/health\n`);
  process.stdout.write(`  Search:  ${apiUrl}/v1/search?q=...\n`);
  process.stdout.write(`  Tools:   ${apiUrl}/v1/tools\n`);

  // Spawn the viewer (Astro dev server) alongside the API. Degrades to
  // API-only when @remember/viewer isn't installed or REMEMBER_NO_VIEWER=1.
  const viewer: ViewerHandle | null = await startViewer({
    rootDir: process.cwd(),
    host: cfg.validated.server.host,
    port: cfg.validated.server.port,
    apiUrl: `${apiUrl}/v1`,
  });

  if (viewer) {
    process.stdout.write(`\nremember dev: Viewer at ${viewer.url}\n`);
  }
  process.stdout.write(`\nPress Ctrl+C to stop.\n`);

  // Coordinated shutdown — kill viewer first, then stop the API.
  const shutdown = async () => {
    process.stdout.write('\nremember dev: shutting down…\n');
    if (viewer) viewer.kill();
    if (stopApi) {
      try {
        await stopApi();
      } catch {
        /* swallow — we're exiting */
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Re-throw a viewer crash to the main process so the user knows.
  if (viewer) {
    viewer.child.on('exit', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGINT') return;
      if (code !== 0 && code !== null) {
        process.stderr.write(
          `\nremember dev: viewer exited unexpectedly (code ${code}). API still running.\n`,
        );
      }
    });
  }

  await new Promise<void>(() => {
    // Keep alive — shutdown handler does the exit.
  });
}
