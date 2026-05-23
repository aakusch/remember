import path from 'node:path';
import { startServer } from '../../api/start-server.js';
import { loadConfig } from '../../config/load.js';
import { createChokidarWalker } from '../../walkers/chokidar.js';
import { createRemarkParser } from '../../parsers/remark.js';
import { createSmartSplitChunker } from '../../chunkers/smart-split.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { createIndexer } from '../../indexer/index.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';

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

  const { url } = await startServer({ rootDir: process.cwd() });
  process.stdout.write(`\nremember dev: API listening at ${url}\n`);
  process.stdout.write(`  Health:  ${url}/v1/health\n`);
  process.stdout.write(`  Search:  ${url}/v1/search?q=...\n`);
  process.stdout.write(`  Tools:   ${url}/v1/tools\n`);
  process.stdout.write(`\nViewer scaffold lands in a future commit. For now use the API directly.\n`);
  process.stdout.write(`Press Ctrl+C to stop.\n`);

  await new Promise<void>(() => {
    // Keep alive.
  });
}
