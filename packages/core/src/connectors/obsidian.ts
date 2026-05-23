import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Connector, ConnectorContext, ConnectorSyncResult, ConnectorStatus } from './types.js';

export interface ObsidianConnectorOptions {
  name?: string;
  vaultPath: string;
  target?: string;
  include?: string[]; // glob-ish prefix patterns relative to vault, e.g. ['Reference/']
  exclude?: string[]; // same shape
  transformWikilinks?: boolean;
  tag?: string; // adds a tag to frontmatter on imported pages
}

export function createObsidianConnector(opts: ObsidianConnectorOptions): Connector {
  const name = opts.name ?? 'obsidian';
  const target = opts.target ?? `external/${name}`;
  let lastSync: string | null = null;
  let lastResult: ConnectorSyncResult | null = null;
  let lastError: string | null = null;
  let configured = true;

  const matchAny = (rel: string, patterns: string[] | undefined): boolean => {
    if (!patterns || patterns.length === 0) return false;
    return patterns.some((p) => {
      const norm = p.replace(/\/$/, '').replace(/\/\*\*?$/, '');
      return rel === norm || rel.startsWith(`${norm}/`);
    });
  };

  return {
    name,
    kind: 'obsidian',
    target,
    async init() {
      try {
        const stat = await fs.stat(opts.vaultPath);
        if (!stat.isDirectory()) {
          configured = false;
          lastError = `vaultPath is not a directory: ${opts.vaultPath}`;
        }
      } catch {
        configured = false;
        lastError = `vault not found: ${opts.vaultPath}`;
      }
    },
    async sync(ctx) {
      const started = Date.now();
      let written = 0;
      let unchanged = 0;
      let deleted = 0;

      if (!configured) {
        throw new Error(lastError ?? 'connector not configured');
      }

      const targetAbs = path.join(ctx.contentRoot, target);
      await fs.mkdir(targetAbs, { recursive: true });

      // Walk source vault.
      const sourceFiles = new Map<string, string>();
      const walk = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.')) continue; // skip dot dirs like .obsidian/
          const full = path.join(dir, e.name);
          const rel = path.relative(opts.vaultPath, full).split(path.sep).join('/');
          if (matchAny(rel, opts.exclude)) continue;
          if (e.isDirectory()) {
            await walk(full);
          } else if (e.isFile() && e.name.endsWith('.md')) {
            if (opts.include && opts.include.length > 0 && !matchAny(rel, opts.include)) continue;
            sourceFiles.set(rel, full);
          }
        }
      };
      await walk(opts.vaultPath);

      const seen = new Set<string>();
      for (const [rel, src] of sourceFiles) {
        const dst = path.join(targetAbs, rel);
        await fs.mkdir(path.dirname(dst), { recursive: true });

        let content = await fs.readFile(src, 'utf8');
        if (opts.transformWikilinks) {
          content = content.replace(/\[\[([^\]|\]]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => {
            const display = label ?? target;
            const slug = String(target).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-/]/g, '');
            return `[${display}](./${slug})`;
          });
        }
        if (opts.tag) {
          content = ensureFrontmatterTag(content, opts.tag);
        }

        try {
          const existing = await fs.readFile(dst, 'utf8');
          if (existing === content) {
            unchanged++;
            seen.add(rel);
            continue;
          }
        } catch {
          // dst missing — write
        }
        await fs.writeFile(dst, content, 'utf8');
        written++;
        seen.add(rel);
      }

      // Cleanup orphans in target that no longer exist in source.
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
            // Remove the dir if it's now empty
            try {
              const remaining = await fs.readdir(full);
              if (remaining.length === 0) await fs.rmdir(full);
            } catch {
              /* */
            }
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
        notes: `synced from ${opts.vaultPath}`,
      };
      lastSync = new Date().toISOString();
      lastError = null;
      ctx.events.emit('event', { type: 'connector.synced', connector: name, ...lastResult });
      return lastResult;
    },
    async stop() {
      /* no-op */
    },
    status(): ConnectorStatus {
      return {
        name,
        kind: 'obsidian',
        target,
        configured,
        last_sync_at: lastSync,
        last_result: lastResult,
        last_error: lastError,
      };
    },
  };
}

function ensureFrontmatterTag(content: string, tag: string): string {
  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!fmMatch) {
    return `---\ntags: [${tag}]\n---\n\n${content}`;
  }
  const fm = fmMatch[1] ?? '';
  if (new RegExp(`tags:[^\\n]*\\b${tag}\\b`).test(fm)) return content;
  let newFm: string;
  const tagsLineMatch = /^tags:\s*(\[[^\]]*\]|.*)$/m.exec(fm);
  if (tagsLineMatch) {
    const existing = tagsLineMatch[1] ?? '';
    if (existing.startsWith('[') && existing.endsWith(']')) {
      const inner = existing.slice(1, -1).trim();
      newFm = fm.replace(tagsLineMatch[0], `tags: [${inner ? `${inner}, ${tag}` : tag}]`);
    } else {
      newFm = fm.replace(tagsLineMatch[0], `tags: [${existing.trim()}, ${tag}]`);
    }
  } else {
    newFm = `${fm}\ntags: [${tag}]`;
  }
  return content.replace(fmMatch[0], `---\n${newFm}\n---\n`);
}
