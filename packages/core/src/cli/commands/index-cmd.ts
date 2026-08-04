import path from 'node:path';
import { loadConfig } from '../../config/load.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { createDefaultIndexer } from '../../api/open-wiki.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { VERSION } from '../../version.js';
import { banner, header, keyValues, success, c, fmtMs, plural, IS_TTY } from '../format.js';

/**
 * `remember index` — (re)index the content directory into the local store.
 */
export async function indexCommand(): Promise<void> {
  const cfg = await loadConfig(process.cwd());
  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);
  const contentDisplay = path.relative(process.cwd(), contentRoot) || '.';
  const out = process.stdout;

  out.write(`\n${banner(VERSION)}  ${c.dim('index')}\n`);

  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });
  const reconcile = store.reconcileEmbedder(embedder.modelId, embedder.dim);
  if (reconcile.changed) {
    process.stderr.write(
      `remember: index was built with a different embedder (${reconcile.previousModelId}) — cleared and re-embedding from scratch with ${embedder.modelId}.\n`,
    );
  }

  out.write(
    header('scanning') +
      '\n' +
      keyValues([
        ['content', contentDisplay],
        ['embedder', `${embedder.modelId} ${c.dim(`(${embedder.dim}-d)`)}`],
      ]) +
      '\n\n',
  );

  const indexer = createDefaultIndexer(store, embedder, cfg.validated.index.formats);

  let lastFile = '';
  const result = await indexer.indexAll(contentRoot, (p) => {
    if (p.stage === 'embed' && p.path && p.path !== lastFile) {
      lastFile = p.path;
      // Overwrite on a TTY; one line per file on a pipe (no spam).
      const line = `  ${c.dim('embedding')} ${p.path} ${c.dim(`(${p.total} chunks)`)}`;
      if (IS_TTY) out.write(`\r${line}\x1b[K`);
      else out.write(line + '\n');
    }
  });
  if (IS_TTY && lastFile) out.write('\r\x1b[K');

  store.close();

  out.write(
    `${success(`indexed ${c.bold(plural(result.files_indexed, 'file'))} ${c.dim(`in ${fmtMs(result.duration_ms)}`)}`)}\n` +
      keyValues([
        ['added', c.bold(plural(result.chunks_added, 'chunk'))],
        ['unchanged', plural(result.files_skipped, 'file')],
        ['removed', plural(result.files_deleted, 'file')],
      ]) +
      '\n',
  );

  // Surface per-file failures (bad frontmatter, unreadable files) with the path,
  // rather than aborting the whole run or hiding a silently-partial index.
  if (result.errors.length > 0) {
    const errOut = process.stderr;
    errOut.write(`\n${c.yellow(`! ${plural(result.errors.length, 'file')} skipped due to errors:`)}\n`);
    for (const e of result.errors) {
      errOut.write(`  ${c.dim('•')} ${e.path}: ${e.error}\n`);
    }
    errOut.write('\n');
  }
}
