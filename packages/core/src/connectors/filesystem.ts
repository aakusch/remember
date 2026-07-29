import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Connector, ConnectorSyncResult, ConnectorStatus } from './types.js';

export interface FilesystemConnectorOptions {
  name?: string;
  /** Absolute or rootDir-relative source directory. */
  sourcePath: string;
  /** Where inside content/ to land it. Default `_<name>`. */
  target?: string;
  tag?: string;
}

/**
 * Generic markdown-folder sync. Use this to ingest content from any local folder
 * — useful for exported meeting notes, scraped pages, hand-maintained reference
 * folders, etc. The Obsidian connector is a specialization of this.
 */
export function createFilesystemConnector(opts: FilesystemConnectorOptions): Connector {
  const name = opts.name ?? 'filesystem';
  const target = opts.target ?? `external/${name}`;
  let lastSync: string | null = null;
  let lastResult: ConnectorSyncResult | null = null;
  let lastError: string | null = null;
  let configured = true;

  return {
    name,
    kind: 'filesystem',
    target,
    async init() {
      try {
        const stat = await fs.stat(opts.sourcePath);
        if (!stat.isDirectory()) {
          configured = false;
          lastError = `sourcePath is not a directory: ${opts.sourcePath}`;
        }
      } catch {
        configured = false;
        lastError = `source not found: ${opts.sourcePath}`;
      }
    },
    async sync(ctx) {
      if (!configured) {
        throw new Error(lastError ?? 'connector not configured');
      }
      const started = Date.now();
      const targetAbs = path.join(ctx.contentRoot, target);
      await fs.mkdir(targetAbs, { recursive: true });

      const seen = new Set<string>();
      let written = 0;
      let unchanged = 0;
      let deleted = 0;

      const walk = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const full = path.join(dir, e.name);
          const rel = path.relative(opts.sourcePath, full).split(path.sep).join('/');
          if (e.isDirectory()) {
            await walk(full);
          } else if (e.isFile() && e.name.endsWith('.md')) {
            const dst = path.join(targetAbs, rel);
            seen.add(rel);
            await fs.mkdir(path.dirname(dst), { recursive: true });
            const content = await fs.readFile(full, 'utf8');
            try {
              const existing = await fs.readFile(dst, 'utf8');
              if (existing === content) {
                unchanged++;
                continue;
              }
            } catch {
              /* missing */
            }
            await fs.writeFile(dst, content, 'utf8');
            written++;
          }
        }
      };
      await walk(opts.sourcePath);

      // Cleanup orphans
      const cleanup = async (dir: string, baseRel: string): Promise<void> => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          const rel = baseRel ? `${baseRel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            await cleanup(full, rel);
          } else if (e.isFile() && e.name.endsWith('.md')) {
            if (!seen.has(rel)) {
              await fs.unlink(full);
              deleted++;
            }
          }
        }
      };
      await cleanup(targetAbs, '');

      lastResult = {
        files_written: written,
        files_unchanged: unchanged,
        files_deleted: deleted,
        duration_ms: Date.now() - started,
        notes: `synced from ${opts.sourcePath}`,
      };
      lastSync = new Date().toISOString();
      lastError = null;
      ctx.events.emit('event', { type: 'connector.synced', connector: name, ...lastResult });
      return lastResult;
    },
    async stop() {
      /* */
    },
    status(): ConnectorStatus {
      return {
        name,
        kind: 'filesystem',
        target,
        configured,
        last_sync_at: lastSync,
        last_result: lastResult,
        last_error: lastError,
      };
    },
  };
}
