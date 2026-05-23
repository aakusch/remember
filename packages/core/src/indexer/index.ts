import path from 'node:path';
import type { Chunker, Embedder, Parser, Store, Walker } from '../types.js';

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
}

export interface IndexProgress {
  stage: 'walk' | 'parse' | 'embed' | 'store' | 'done';
  current?: number;
  total?: number;
  path?: string;
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

      for await (const entry of opts.walker.walk(root)) {
        seenPaths.add(entry.path);
        const prev = manifest[entry.path];

        if (prev && prev.sha256 === entry.sha256) {
          filesSkipped++;
          continue;
        }

        onProgress?.({ stage: 'parse', path: entry.path });
        const parsed = opts.parser.parse(entry.content);
        const chunks = opts.chunker.chunk({ plain: parsed.plain, ast: parsed.ast });

        if (chunks.length === 0) {
          // Empty file — remove from index but keep manifest entry so we don't reprocess.
          await opts.store.deleteByPath(entry.path);
          await opts.store.updateManifest(entry.path, {
            sha256: entry.sha256,
            chunk_count: 0,
            last_indexed: new Date().toISOString(),
          });
          filesIndexed++;
          continue;
        }

        // Stamp ids + source_path on chunks
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
          last_indexed: new Date().toISOString(),
        });
        filesIndexed++;
        chunksAdded += chunks.length;
      }

      // Remove manifest + chunks for files no longer present.
      let filesDeleted = 0;
      for (const p of Object.keys(manifest)) {
        if (!seenPaths.has(p)) {
          await opts.store.deleteByPath(p);
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
      };
    },

    async indexOne(root: string, relPath: string): Promise<{ chunks_added: number }> {
      const { promises: fs } = await import('node:fs');
      const { createHash } = await import('node:crypto');
      const abs = path.resolve(root, relPath);
      const content = await fs.readFile(abs, 'utf8');
      const sha256 = createHash('sha256').update(content).digest('hex');

      const parsed = opts.parser.parse(content);
      const chunks = opts.chunker.chunk({ plain: parsed.plain, ast: parsed.ast });

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
        last_indexed: new Date().toISOString(),
      });

      return { chunks_added: chunks.length };
    },
  };
}
