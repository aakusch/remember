import path from 'node:path';
import { loadConfig } from '../../config/load.js';
import { requireWiki } from '../require-wiki.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { VERSION } from '../../version.js';
import { banner, header, keyValues, c, fmtWhen, warn } from '../format.js';

/** Machine-stable shape emitted by `remember status --json`. Keep field names/order stable. */
export interface StatusJsonOutput {
  version: string;
  index: {
    pages: number;
    chunks: number;
    embedder: { model: string; dim: number };
    last_indexed: string | null;
  };
  project: {
    config_path: string | null;
    content_path: string;
  };
}

export async function runStatus(rootDir?: string): Promise<StatusJsonOutput> {
  const cfg = await loadConfig(rootDir ?? process.cwd());
  await requireWiki(cfg);
  const embedder = await resolveEmbedder(cfg.raw);
  const store = await createSqliteVecStore({
    path: path.join(cfg.rootDir, '.remember', 'index.db'),
    dim: embedder.dim,
  });
  try {
    const manifest = await store.getManifest();
    const pages = Object.keys(manifest).length;
    const chunks = Object.values(manifest).reduce((sum, e) => sum + e.chunk_count, 0);
    const lastIndexed = Object.values(manifest)
      .map((e) => e.last_indexed)
      .sort()
      .pop();
    return {
      version: VERSION,
      index: {
        pages,
        chunks,
        embedder: { model: embedder.modelId, dim: embedder.dim },
        last_indexed: lastIndexed ?? null,
      },
      project: {
        config_path: cfg.configPath,
        content_path: path.resolve(cfg.rootDir, cfg.validated.content),
      },
    };
  } finally {
    store.close();
  }
}

/**
 * `remember status` — a tidy dashboard of the local index: page + chunk
 * counts, embedding model, index freshness, config + content locations.
 * `--json` emits the machine-stable shape for scripts and agents.
 */
export async function statusCommand(argv: string[] = []): Promise<void> {
  const json = argv.includes('--json');
  const s = await runStatus();

  if (json) {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n');
    return;
  }

  const out = process.stdout;
  out.write(`\n${banner(VERSION)}  ${c.dim('status')}\n`);

  out.write(
    header('index') +
      '\n' +
      keyValues([
        ['pages', c.bold(String(s.index.pages))],
        ['chunks', c.bold(String(s.index.chunks))],
        ['embedder', `${s.index.embedder.model} ${c.dim(`(${s.index.embedder.dim}-d)`)}`],
        ['last index', fmtWhen(s.index.last_indexed)],
      ]) +
      '\n',
  );

  out.write(
    header('project') +
      '\n' +
      keyValues([
        [
          'config',
          s.project.config_path
            ? path.relative(process.cwd(), s.project.config_path) || s.project.config_path
            : c.dim('(defaults — no remember.config.ts found)'),
        ],
        ['content', path.relative(process.cwd(), s.project.content_path) || '.'],
      ]) +
      '\n',
  );

  if (s.index.pages === 0) {
    out.write(`\n${warn('index is empty')} ${c.dim('— run `remember index` (or `remember dev`) to build it.')}\n`);
  }
}
