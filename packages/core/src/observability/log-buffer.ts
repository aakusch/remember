/**
 * In-memory ring buffer of recent events — errors, warnings, lifecycle
 * milestones — surfaced via GET /v1/logs and the Diagnostics page.
 *
 * Capacity is small on purpose (50 entries). This is meant for "what just
 * went wrong" debugging, not durable observability. For real logging, drain
 * via stdout to a file or platform-managed log shipper.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  at: string; // ISO timestamp
  level: LogLevel;
  source: string; // 'indexer' | 'http' | 'config' | etc.
  message: string;
  detail?: Record<string, unknown>;
}

export interface LogBuffer {
  push(entry: Omit<LogEntry, 'at'>): void;
  list(opts?: { level?: LogLevel; limit?: number }): LogEntry[];
  clear(): void;
  size(): number;
}

export function createLogBuffer(capacity = 50): LogBuffer {
  const ring: LogEntry[] = [];

  return {
    push(entry) {
      const full: LogEntry = { ...entry, at: new Date().toISOString() };
      ring.push(full);
      while (ring.length > capacity) ring.shift();
    },
    list(opts = {}) {
      const { level, limit } = opts;
      let out = ring.slice();
      if (level) out = out.filter((e) => e.level === level);
      // Newest first.
      out.reverse();
      if (limit && limit > 0) out = out.slice(0, limit);
      return out;
    },
    clear() {
      ring.length = 0;
    },
    size() {
      return ring.length;
    },
  };
}
