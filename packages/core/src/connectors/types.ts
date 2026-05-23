import type { EventEmitter } from 'node:events';

export interface ConnectorContext {
  contentRoot: string;
  rootDir: string;
  stateDir: string;
  events: EventEmitter;
}

export interface ConnectorSyncResult {
  files_written: number;
  files_unchanged: number;
  files_deleted: number;
  duration_ms: number;
  notes?: string;
}

export interface ConnectorStatus {
  name: string;
  kind: string;
  target: string;
  configured: boolean;
  last_sync_at: string | null;
  last_result: ConnectorSyncResult | null;
  last_error: string | null;
}

export interface Connector {
  readonly name: string;
  readonly kind: string;
  readonly target: string;
  init(ctx: ConnectorContext): Promise<void>;
  sync(ctx: ConnectorContext): Promise<ConnectorSyncResult>;
  stop(): Promise<void>;
  status(): ConnectorStatus;
}
