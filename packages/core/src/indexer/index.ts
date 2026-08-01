import path from 'node:path';
import type { Chunker, Embedder, Parser, Store, Walker } from '../types.js';

/**
 * Upper bound on a single file read by indexOne. Matches the walker's default
 * cap so the single-file path can't be used to buffer an arbitrarily large
 * file into memory (the bulk walk already enforces its own limit).
 */
const MAX_INDEXABLE_FILE_BYTES = 5 * 1024 * 1024;

export interface IndexerOptions {
  walker: Walker;
  parser: Parser;
  chunker: Chunker;
  embedder: Embedder;
  store: Store;
}

export interface IndexResult {
  files_indexed: number;
  files_skipped: number;
  files_deleted: number;
  chunks_added: number;
  duration_ms: number;
  /** Files that threw during parse/chunk/embed/store — skipped, their prior index kept. */
  errors: Array<{ path: string; error: string }>;
}

export interface IndexProgress {
  stage: 'walk' | 'parse' | 'embed' | 'store' | 'done';
  current?: number;
  total?: number;
  path?: string;
}

function pickTitle(frontmatter: Record<string, unknown>, fallback: string): string | null {
  const t = frontmatter['title'];
  if (typeof t === 'string' && t.trim()) return t;
  // Fallback: derive from filename
  const base = fallback.split('/').pop() ?? fallback;
  const stem = base.replace(/\.md$/, '');
  if (!stem) return null;
  return stem
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

export function createIndexer(opts: IndexerOptions) {
  return {
    async indexAll(root: string, onProgress?: (p: IndexProgress) => void): Promise<IndexResult> {
      const started = Date.now();
      const manifest = await opts.store.getManifest();
      const seenPaths = new Set<string>();

      let filesIndexed = 0;
      let filesSkipped = 0;
      let chunksAdded = 0;
      const errors: Array<{ path: string; error: string }> = [];

      for await (const entry of opts.walker.walk(root)) {
        seenPaths.add(entry.path);
        const prev = manifest[entry.path];

        if (prev && prev.sha256 === entry.sha256) {
          filesSkipped++;
          continue;
        }

        // Why: a single file with malformed YAML frontmatter (or any parse/embed
        // failure) used to throw straight out of this loop, aborting the whole run,
        // blocking `remember dev` from booting, and wedging the watcher — with no
        // mention of which file. Isolate per file: record the error, keep the file's
        // previous index (it stays in seenPaths so the delete-sweep won't purge it),
        // and continue.
        try {
          onProgress?.({ stage: 'parse', path: entry.path });
          const parsed = opts.parser.parse(entry.content);
          const chunks = opts.chunker.chunk({ plain: parsed.plain, ast: parsed.ast });
          const nowIso = new Date().toISOString();

          // Always upsert the page record — frontmatter is per-page metadata,
          // independent of whether the page has body chunks.
          await opts.store.upsertPage({
            path: entry.path,
            frontmatter: parsed.frontmatter ?? {},
            title: pickTitle(parsed.frontmatter ?? {}, entry.path),
            size: entry.content.length,
            last_indexed: nowIso,
            last_modified: entry.mtime.toISOString(),
          });

          if (chunks.length === 0) {
            // Empty file — remove chunks but keep page record + manifest stamp.
            await opts.store.deleteByPath(entry.path);
            await opts.store.updateManifest(entry.path, {
              sha256: entry.sha256,
              chunk_count: 0,
              last_indexed: nowIso,
            });
            filesIndexed++;
            continue;
          }

          for (const c of chunks) {
            c.source_path = entry.path;
            c.id = `${entry.path}#${c.chunk_idx}`;
          }

          onProgress?.({ stage: 'embed', path: entry.path, total: chunks.length });
          const vectors = await opts.embedder.embed(chunks.map((c) => c.text));
          const withVectors = chunks.map((c, i) => ({ ...c, embedding: vectors[i]! }));

          onProgress?.({ stage: 'store', path: entry.path });
          await opts.store.deleteByPath(entry.path);
          await opts.store.upsert(withVectors);
          await opts.store.updateManifest(entry.path, {
            sha256: entry.sha256,
            chunk_count: chunks.length,
            last_indexed: nowIso,
          });
          filesIndexed++;
          chunksAdded += chunks.length;
        } catch (err) {
          errors.push({ path: entry.path, error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Remove records for files no longer present.
      let filesDeleted = 0;
      for (const p of Object.keys(manifest)) {
        if (!seenPaths.has(p)) {
          await opts.store.deleteByPath(p);
          await opts.store.deletePage(p);
          await opts.store.updateManifest(p, null);
          filesDeleted++;
        }
      }

      onProgress?.({ stage: 'done' });

      return {
        files_indexed: filesIndexed,
        files_skipped: filesSkipped,
        files_deleted: filesDeleted,
        chunks_added: chunksAdded,
        duration_ms: Date.now() - started,
        errors,
      };
    },

    async indexOne(root: string, relPath: string): Promise<{ chunks_added: number }> {
      const { promises: fs } = await import('node:fs');
      const { createHash } = await import('node:crypto');
      // Enforce content-root containment here rather than trusting the caller.
      // Why: indexOne touches the filesystem directly (readFile/stat); the FS
      // layer must own its own path-traversal invariant even if every current
      // caller already validates (routes.ts does). Mirrors safeJoinContent.
      const normalized = path.normalize(relPath).replace(/^[/\\]+/, '');
      const abs = path.resolve(root, normalized);
      const rel = path.relative(root, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Refused path traversal: "${relPath}" resolves outside ${root}`);
      }
      const stat = await fs.stat(abs);
      // Reject oversized files rather than buffering them whole (memory-DoS guard).
      if (stat.size > MAX_INDEXABLE_FILE_BYTES) {
        throw new Error(
          `File too large to index: "${relPath}" is ${stat.size} bytes (limit ${MAX_INDEXABLE_FILE_BYTES})`,
        );
      }
      const content = await fs.readFile(abs, 'utf8');
      const sha256 = createHash('sha256').update(content).digest('hex');
      const nowIso = new Date().toISOString();

      const parsed = opts.parser.parse(content);
      const chunks = opts.chunker.chunk({ plain: parsed.plain, ast: parsed.ast });

      await opts.store.upsertPage({
        path: relPath,
        frontmatter: parsed.frontmatter ?? {},
        title: pickTitle(parsed.frontmatter ?? {}, relPath),
        size: content.length,
        last_indexed: nowIso,
        last_modified: stat.mtime.toISOString(),
      });

      for (const c of chunks) {
        c.source_path = relPath;
        c.id = `${relPath}#${c.chunk_idx}`;
      }

      const vectors = await opts.embedder.embed(chunks.map((c) => c.text));
      const withVectors = chunks.map((c, i) => ({ ...c, embedding: vectors[i]! }));

      await opts.store.deleteByPath(relPath);
      await opts.store.upsert(withVectors);
      await opts.store.updateManifest(relPath, {
        sha256,
        chunk_count: chunks.length,
        last_indexed: nowIso,
      });

      return { chunks_added: chunks.length };
    },
  };
}
