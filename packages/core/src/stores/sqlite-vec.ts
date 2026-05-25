import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import type { Chunk, PageQuery, PageRecord, SearchResult, Store } from '../types.js';
import { extractSnippet } from '../search/snippet.js';

export interface SqliteVecStoreOptions {
  path?: string;
  dim?: number;
}

export interface HistoryWriteInput {
  path: string;
  body: string;
  frontmatter?: Record<string, unknown>;
}
export interface HistoryEntry {
  id: number;
  path: string;
  sha256: string;
  byte_size: number;
  written_at: string;
}
export interface HistoryFull extends HistoryEntry {
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface SqliteVecStore extends Store {
  close(): void;
  setDimension(dim: number): void;
  appendHistory(entry: HistoryWriteInput): number;
  listHistory(path: string, limit?: number): HistoryEntry[];
  getHistoryEntry(id: number): HistoryFull | null;
  pruneHistory(path: string, keep?: number): number;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
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

    async searchVector(embedding, k, query) {
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
        snippet: makeSnippet(r.text, query),
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

    async upsertPage(rec: PageRecord) {
      const fmJson = JSON.stringify(rec.frontmatter ?? {});
      const upsert = db.prepare(
        `INSERT OR REPLACE INTO pages (path, frontmatter, title, size, last_indexed, last_modified)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const delAttrs = db.prepare('DELETE FROM page_attrs WHERE path = ?');
      const insAttr = db.prepare(
        'INSERT INTO page_attrs (path, key, value) VALUES (?, ?, ?)',
      );
      const txn = db.transaction(() => {
        upsert.run(rec.path, fmJson, rec.title, rec.size, rec.last_indexed, rec.last_modified);
        delAttrs.run(rec.path);
        // Flatten frontmatter into (key, value) rows for fast filter queries.
        for (const [k, v] of Object.entries(rec.frontmatter ?? {})) {
          if (Array.isArray(v)) {
            for (const item of v) insAttr.run(rec.path, k, String(item));
          } else if (v !== null && v !== undefined && typeof v !== 'object') {
            insAttr.run(rec.path, k, String(v));
          } else if (v instanceof Date) {
            insAttr.run(rec.path, k, v.toISOString());
          }
        }
      });
      txn();
    },

    async deletePage(sourcePath: string) {
      db.prepare('DELETE FROM pages WHERE path = ?').run(sourcePath);
      db.prepare('DELETE FROM page_attrs WHERE path = ?').run(sourcePath);
    },

    async queryPages(q: PageQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];

      if (q.filter) {
        for (const [k, v] of Object.entries(q.filter)) {
          filters.push(
            `path IN (SELECT path FROM page_attrs WHERE key = ? AND value = ?)`,
          );
          params.push(k, String(v));
        }
      }
      if (q.q && q.q.trim()) {
        filters.push(`(LOWER(title) LIKE ? OR LOWER(path) LIKE ?)`);
        const like = `%${q.q.trim().toLowerCase()}%`;
        params.push(like, like);
      }

      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      // Sort handling
      let orderBy = 'ORDER BY path ASC';
      if (q.sort) {
        const desc = q.sort.startsWith('-');
        const rawKey = (desc ? q.sort.slice(1) : q.sort).trim();
        const dir = desc ? 'DESC' : 'ASC';
        // Map friendly aliases to actual column names
        const SYSTEM_COLS: Record<string, string> = {
          path: 'path',
          modified: 'last_modified',
          last_modified: 'last_modified',
          last_indexed: 'last_indexed',
          title: 'title',
          size: 'size',
        };
        const sysCol = SYSTEM_COLS[rawKey];
        if (sysCol) {
          orderBy = `ORDER BY ${sysCol} ${dir}`;
        } else {
          // Sort by a frontmatter attribute via correlated subquery.
          orderBy = `ORDER BY (SELECT value FROM page_attrs WHERE page_attrs.path = pages.path AND key = ? LIMIT 1) ${dir}`;
          params.push(rawKey);
        }
      }

      const limit = Math.max(1, Math.min(500, q.limit ?? 200));
      const offset = Math.max(0, q.offset ?? 0);

      const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM pages ${where}`).get(...params.slice(0, filters.length === 0 ? 0 : params.length - (q.sort && !['path','last_modified','title','size','last_indexed'].includes((q.sort.startsWith('-') ? q.sort.slice(1) : q.sort)) ? 1 : 0))) as { n: number };

      const rows = db
        .prepare(
          `SELECT path, frontmatter, title, size, last_indexed, last_modified
           FROM pages
           ${where}
           ${orderBy}
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{
        path: string;
        frontmatter: string;
        title: string | null;
        size: number;
        last_indexed: string;
        last_modified: string;
      }>;

      return {
        total: totalRow?.n ?? 0,
        rows: rows.map((r) => ({
          path: r.path,
          title: r.title,
          size: r.size,
          last_indexed: r.last_indexed,
          last_modified: r.last_modified,
          frontmatter: safeJsonParse(r.frontmatter),
        })),
      };
    },

    async listFrontmatterKeys() {
      const rows = db
        .prepare('SELECT DISTINCT key FROM page_attrs ORDER BY key')
        .all() as Array<{ key: string }>;
      return rows.map((r) => r.key);
    },

    // ─── Page history ─────────────────────────────────────────────────────
    appendHistory(entry: HistoryWriteInput): number {
      const sha = sha256(entry.body);
      const written_at = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO page_history (path, sha256, body, frontmatter, byte_size, written_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.path,
          sha,
          entry.body,
          JSON.stringify(entry.frontmatter ?? {}),
          Buffer.byteLength(entry.body, 'utf8'),
          written_at,
        );
      return Number(info.lastInsertRowid);
    },
    listHistory(path: string, limit = 10): HistoryEntry[] {
      const rows = db
        .prepare(
          `SELECT id, path, sha256, byte_size, written_at FROM page_history
           WHERE path = ?
           ORDER BY written_at DESC LIMIT ?`,
        )
        .all(path, Math.max(1, Math.min(limit, 100))) as Array<{
        id: number;
        path: string;
        sha256: string;
        byte_size: number;
        written_at: string;
      }>;
      return rows;
    },
    getHistoryEntry(id: number): HistoryFull | null {
      const row = db
        .prepare(
          `SELECT id, path, sha256, body, frontmatter, byte_size, written_at FROM page_history WHERE id = ?`,
        )
        .get(id) as
        | {
            id: number;
            path: string;
            sha256: string;
            body: string;
            frontmatter: string;
            byte_size: number;
            written_at: string;
          }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        path: row.path,
        sha256: row.sha256,
        body: row.body,
        frontmatter: safeJsonParse(row.frontmatter),
        byte_size: row.byte_size,
        written_at: row.written_at,
      };
    },
    pruneHistory(path: string, keep = 50): number {
      const info = db
        .prepare(
          `DELETE FROM page_history
           WHERE id IN (
             SELECT id FROM page_history WHERE path = ?
             ORDER BY written_at DESC LIMIT -1 OFFSET ?
           )`,
        )
        .run(path, Math.max(1, keep));
      return info.changes;
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

    CREATE TABLE IF NOT EXISTS pages (
      path TEXT PRIMARY KEY,
      frontmatter TEXT NOT NULL DEFAULT '{}',
      title TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      last_indexed TEXT NOT NULL,
      last_modified TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_attrs (
      path TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      FOREIGN KEY(path) REFERENCES pages(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_page_attrs_kv ON page_attrs(key, value);
    CREATE INDEX IF NOT EXISTS idx_page_attrs_path ON page_attrs(path);

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(text, content='', contentless_delete=1);

    CREATE TABLE IF NOT EXISTS page_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      body TEXT NOT NULL,
      frontmatter TEXT NOT NULL DEFAULT '{}',
      byte_size INTEGER NOT NULL,
      written_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_page_history_path ON page_history(path, written_at DESC);
  `);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dim}])`);
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// makeSnippet was replaced by extractSnippet (see ../search/snippet.ts).
// Kept as a thin shim so existing callers don't have to change their call
// shape; the new module handles query-aware passage extraction.
function makeSnippet(text: string, query?: string): string {
  return extractSnippet(text, query);
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
