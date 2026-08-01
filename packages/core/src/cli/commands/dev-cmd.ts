import path from 'node:path';
import { startServer } from '../../api/start-server.js';
import { loadConfig } from '../../config/load.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { createDefaultIndexer } from '../../api/open-wiki.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { VERSION } from '../../version.js';
import { banner, header, keyValues, success, c, fmtMs, plural } from '../format.js';

/**
 * `remember dev` — index the content folder, then start the agent API with a
 * live file watcher. CLI + API only; there is no browser UI in the OSS engine.
 */
export async function devCommand(): Promise<void> {
  const cfg = await loadConfig(process.cwd());
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);
  const contentDisplay = path.relative(process.cwd(), contentRoot) || '.';
  const out = process.stdout;

  out.write(`\n${banner(VERSION)}  ${c.dim('dev')}\n`);

  // ─── Index ────────────────────────────────────────────────────────────────
  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });
  const reconcile = store.reconcileEmbedder(embedder.modelId, embedder.dim);
  if (reconcile.changed) {
    process.stderr.write(
      `remember: index was built with a different embedder (${reconcile.previousModelId}) and was cleared — it will re-embed on the next index pass with ${embedder.modelId}.\n`,
    );
  }

  const indexer = createDefaultIndexer(store, embedder);

  const initial = await indexer.indexAll(contentRoot);
  store.close();
  out.write(
    `\n${success(
      `indexed ${c.bold(plural(initial.files_indexed, 'file'))} · ` +
        `${c.bold(plural(initial.chunks_added, 'chunk'))} ${c.dim(`in ${fmtMs(initial.duration_ms)}`)}`,
    )}\n`,
  );
  if (initial.errors.length > 0) {
    process.stderr.write(
      `${c.yellow(`! ${plural(initial.errors.length, 'file')} skipped due to errors:`)}\n`,
    );
    for (const e of initial.errors) {
      process.stderr.write(`  ${c.dim('•')} ${e.path}: ${e.error}\n`);
    }
  }

  // ─── Serve ──────────────────────────────────────────────────────────────
  const { url: apiUrl, close: stopApi } = await startServer({ rootDir: process.cwd() });

  out.write(header('API + agent endpoints'));
  out.write(
    '\n' +
      keyValues([
        ['content', `${contentDisplay}  ${c.dim('(watching for changes)')}`],
        ['embedder', `${embedder.modelId} ${c.dim(`(${embedder.dim}-d)`)}`],
        ['base', c.accent(apiUrl)],
        ['health', `${apiUrl}/v1/health`],
        ['search', `${apiUrl}/v1/search?q=…`],
        ['pages', `${apiUrl}/v1/pages`],
        ['tools', `${apiUrl}/v1/tools  ${c.dim('(agent tool defs)')}`],
      ]) +
      '\n',
  );
  out.write(`\n${c.dim('Watching for file changes — edits reindex within ~1s. Press Ctrl+C to stop.')}\n`);

  const shutdown = async () => {
    out.write(`\n${c.dim('shutting down…')}\n`);
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

  await new Promise<void>(() => {
    // Keep alive — shutdown handler does the exit.
  });
}
