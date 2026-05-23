import path from 'node:path';
import { loadConfig } from '../../config/load.js';
import { createChokidarWalker } from '../../walkers/chokidar.js';
import { createRemarkParser } from '../../parsers/remark.js';
import { createSmartSplitChunker } from '../../chunkers/smart-split.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { createIndexer } from '../../indexer/index.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';

export async function indexCommand(): Promise<void> {
  const cfg = await loadConfig(process.cwd());
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);

  process.stdout.write(`remember index: scanning ${contentRoot}\n`);

  const embedder = await resolveEmbedder(cfg.raw);
  process.stdout.write(`  embedder: ${embedder.modelId} (${embedder.dim}-d)\n`);

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

  const result = await indexer.indexAll(contentRoot, (p) => {
    if (p.stage === 'embed' && p.path) {
      process.stdout.write(`  embedding ${p.path} (${p.total} chunks)\n`);
    }
  });

  store.close();

  process.stdout.write(
    `\nDone in ${result.duration_ms}ms\n` +
      `  ${result.files_indexed} files indexed (${result.files_skipped} unchanged, ${result.files_deleted} removed)\n` +
      `  ${result.chunks_added} chunks added\n`,
  );
}
