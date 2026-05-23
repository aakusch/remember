import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Chunk, SearchResult, Store } from '../types.js';

export interface SqliteVecStoreOptions {
  path?: string;
  dim?: number;
}

export interface SqliteVecStore extends Store {
  close(): void;
  setDimension(dim: number): void;
}

export async function createSqliteVecStore(opts: SqliteVecStoreOptions = {}): Promise<SqliteVecStore> {
  const dbPath = opts.path ?? '.remember/index.db';
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  sqliteVec.load(db);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  let dim = opts.dim ?? 384;
  initSchema(db, dim);

  return {
    async upsert(chunks) {
      if (chunks.length === 0) return;
      const insertChunk = db.prepare(
        `INSERT OR REPLACE INTO chunks (id, source_path, chunk_idx, text, heading_path)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const insertVec = db.prepare(
        `INSERT OR REPLACE INTO vec_chunks (rowid, embedding)
         VALUES ((SELECT rowid FROM chunks WHERE id = ?), ?)`,
      );
      const insertFts = db.prepare(
        `INSERT OR REPLACE INTO fts_chunks (rowid, text)
         VALUES ((SELECT rowid FROM chunks WHERE id = ?), ?)`,
      );
      const txn = db.transaction((rows: Array<Chunk & { embedding: number[] }>) => {
        for (const row of rows) {
          insertChunk.run(
            row.id,
            row.source_path,
            row.chunk_idx,
            row.text,
            JSON.stringify(row.heading_path),
          );
          insertVec.run(row.id, Buffer.from(new Float32Array(row.embedding).buffer));
          insertFts.run(row.id, row.text);
        }
      });
      txn(chunks);
    },

    async deleteByPath(sourcePath) {
      const ids = db
        .prepare('SELECT id, rowid FROM chunks WHERE source_path = ?')
        .all(sourcePath) as { id: string; rowid: number }[];
      if (ids.length === 0) return 0;
      const txn = db.transaction(() => {
        const delFts = db.prepare('DELETE FROM fts_chunks WHERE rowid = ?');
        const delVec = db.prepare('DELETE FROM vec_chunks WHERE rowid = ?');
        const delChunk = db.prepare('DELETE FROM chunks WHERE id = ?');
        for (const { id, rowid } of ids) {
          delFts.run(rowid);
          delVec.run(rowid);
          delChunk.run(id);
        }
      });
      txn();
      return ids.length;
    },

    async searchVector(embedding, k) {
      const buf = Buffer.from(new Float32Array(embedding).buffer);
      const rows = db
        .prepare(
          `SELECT c.id AS chunk_id, c.source_path, c.chunk_idx, c.text, c.heading_path, v.distance
           FROM vec_chunks v
           JOIN chunks c ON c.rowid = v.rowid
           WHERE v.embedding MATCH ? AND k = ?
           ORDER BY v.distance`,
        )
        .all(buf, k) as Array<{
        chunk_id: string;
        source_path: string;
        chunk_idx: number;
        text: string;
        heading_path: string;
        distance: number;
      }>;

      return rows.map((r) => ({
        path: r.source_path,
        chunk_idx: r.chunk_idx,
        snippet: makeSnippet(r.text),
        frontmatter: getFrontmatter(db, r.source_path),
        score: 1 / (1 + r.distance),
        retrievers: ['vector'] as ('bm25' | 'vector')[],
        chunk_id: r.chunk_id,
      }));
    },

    async searchBm25(query, k) {
      if (!query.trim()) return [];
      const rows = db
        .prepare(
          `SELECT c.id AS chunk_id, c.source_path, c.chunk_idx, c.text, c.heading_path,
                  bm25(fts_chunks) AS rank
           FROM fts_chunks
           JOIN chunks c ON c.rowid = fts_chunks.rowid
           WHERE fts_chunks MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(escapeFts(query), k) as Array<{
        chunk_id: string;
        source_path: string;
        chunk_idx: number;
        text: string;
        heading_path: string;
        rank: number;
      }>;

      return rows.map((r) => ({
        path: r.source_path,
        chunk_idx: r.chunk_idx,
        snippet: makeSnippet(r.text, query),
        frontmatter: getFrontmatter(db, r.source_path),
        score: 1 / (1 + Math.abs(r.rank)),
        retrievers: ['bm25'] as ('bm25' | 'vector')[],
        chunk_id: r.chunk_id,
      }));
    },

    async getManifest() {
      const rows = db
        .prepare('SELECT path, sha256, chunk_count, last_indexed FROM manifest')
        .all() as Array<{ path: string; sha256: string; chunk_count: number; last_indexed: string }>;
      const out: Record<string, { sha256: string; chunk_count: number; last_indexed: string }> = {};
      for (const r of rows) {
        out[r.path] = { sha256: r.sha256, chunk_count: r.chunk_count, last_indexed: r.last_indexed };
      }
      return out;
    },

    async updateManifest(sourcePath, entry) {
      if (entry === null) {
        db.prepare('DELETE FROM manifest WHERE path = ?').run(sourcePath);
        return;
      }
      db.prepare(
        `INSERT OR REPLACE INTO manifest (path, sha256, chunk_count, last_indexed)
         VALUES (?, ?, ?, ?)`,
      ).run(sourcePath, entry.sha256, entry.chunk_count, entry.last_indexed);
    },

    close() {
      db.close();
    },

    setDimension(newDim: number) {
      if (newDim === dim) return;
      // Rebuild vec table with new dimension. Caller is responsible for full reindex.
      db.exec('DROP TABLE IF EXISTS vec_chunks');
      dim = newDim;
      db.exec(
        `CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[${dim}])`,
      );
    },
  };
}

function initSchema(db: Database.Database, dim: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      chunk_idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      heading_path TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(source_path);

    CREATE TABLE IF NOT EXISTS manifest (
      path TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      chunk_count INTEGER NOT NULL,
      last_indexed TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(text, content='', contentless_delete=1);
  `);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dim}])`);
}

function makeSnippet(text: string, _query?: string): string {
  const max = 280;
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + '…';
}

function getFrontmatter(_db: Database.Database, _sourcePath: string): Record<string, unknown> {
  // v1: store frontmatter per chunk would be wasteful. Frontmatter is page-level;
  // the indexer can backfill this via a side table later. For now return empty.
  return {};
}

function escapeFts(query: string): string {
  // Simple FTS5 escape: quote the whole query so special chars don't blow up.
  return `"${query.replace(/"/g, '""')}"`;
}
