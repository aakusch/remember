import path from 'node:path';
import { loadConfig } from '../../config/load.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { VERSION } from '../../version.js';
import { banner, header, keyValues, c, fmtWhen, warn } from '../format.js';

/**
 * `remember status` — a tidy dashboard of the local index: page + chunk
 * counts, embedding model, index freshness, config + content locations.
 */
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

  const out = process.stdout;
  out.write(`\n${banner(VERSION)}  ${c.dim('status')}\n`);

  out.write(
    header('index') +
      '\n' +
      keyValues([
        ['pages', c.bold(String(pages))],
        ['chunks', c.bold(String(chunks))],
        ['embedder', `${embedder.modelId} ${c.dim(`(${embedder.dim}-d)`)}`],
        ['last index', fmtWhen(lastIndexed)],
      ]) +
      '\n',
  );

  out.write(
    header('project') +
      '\n' +
      keyValues([
        ['config', cfg.configPath ? path.relative(process.cwd(), cfg.configPath) || cfg.configPath : c.dim('(defaults — no remember.config.ts found)')],
        ['content', path.relative(process.cwd(), path.resolve(cfg.rootDir, cfg.validated.content)) || '.'],
      ]) +
      '\n',
  );

  if (pages === 0) {
    out.write(`\n${warn('index is empty')} ${c.dim('— run `remember index` (or `remember dev`) to build it.')}\n`);
  }
}
