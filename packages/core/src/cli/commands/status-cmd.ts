import path from 'node:path';
import { loadConfig } from '../../config/load.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';

export async function statusCommand(): Promise<void> {
  const cfg = await loadConfig(process.cwd());
  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });

  const manifest = await store.getManifest();
  const pages = Object.keys(manifest).length;
  const chunks = Object.values(manifest).reduce((sum, e) => sum + e.chunk_count, 0);
  const lastIndexed = Object.values(manifest)
    .map((e) => e.last_indexed)
    .sort()
    .pop();

  store.close();

  process.stdout.write(`remember status\n`);
  process.stdout.write(`  pages indexed:   ${pages}\n`);
  process.stdout.write(`  chunks:          ${chunks}\n`);
  process.stdout.write(`  embedder:        ${embedder.modelId} (${embedder.dim}-d)\n`);
  process.stdout.write(`  last index:      ${lastIndexed ?? '(never)'}\n`);
  process.stdout.write(`  config:          ${cfg.configPath ?? '(defaults — no remember.config.ts found)'}\n`);
  process.stdout.write(`  content root:    ${path.resolve(cfg.rootDir, cfg.validated.content)}\n`);
}
