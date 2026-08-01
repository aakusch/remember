import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { LoadedConfig } from '../config/load.js';

/**
 * Guard the read commands (search/status/list/get) so they refuse to run outside a
 * wiki instead of silently creating an empty `.remember/index.db` in whatever
 * directory the user happens to be in (which also then poisons a later
 * `remember init .`). A directory counts as a wiki if it has a config file OR an
 * existing index. Must be called BEFORE the store is opened (opening creates the db).
 */
export async function requireWiki(cfg: LoadedConfig): Promise<void> {
  if (cfg.configPath !== null) return;
  const dbPath = path.join(cfg.rootDir, '.remember', 'index.db');
  try {
    await fs.access(dbPath);
    return;
  } catch {
    throw new Error('not a remember wiki here — run `remember init <dir>` or cd into your wiki');
  }
}
