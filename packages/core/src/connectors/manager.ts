import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Connector, ConnectorContext, ConnectorStatus, ConnectorSyncResult } from './types.js';
import type { EventEmitter } from 'node:events';

export interface ConnectorManager {
  list(): ConnectorStatus[];
  get(name: string): Connector | null;
  syncOne(name: string): Promise<ConnectorSyncResult | { error: string }>;
  syncAll(): Promise<Record<string, ConnectorSyncResult | { error: string }>>;
  stopAll(): Promise<void>;
}

export interface ConnectorManagerOptions {
  connectors: Connector[];
  contentRoot: string;
  rootDir: string;
  events: EventEmitter;
}

export async function createConnectorManager(opts: ConnectorManagerOptions): Promise<ConnectorManager> {
  const byName = new Map<string, Connector>();
  for (const c of opts.connectors) {
    if (byName.has(c.name)) {
      throw new Error(`duplicate connector name: ${c.name}`);
    }
    byName.set(c.name, c);
  }

  const stateDir = path.join(opts.rootDir, '.remember', 'connectors');
  await fs.mkdir(stateDir, { recursive: true });

  const ctx: ConnectorContext = {
    contentRoot: opts.contentRoot,
    rootDir: opts.rootDir,
    stateDir,
    events: opts.events,
  };

  // Initialize each connector
  for (const c of opts.connectors) {
    try {
      await c.init(ctx);
    } catch (err) {
      process.stderr.write(`[remember] connector ${c.name} init failed: ${(err as Error).message}\n`);
    }
  }

  return {
    list(): ConnectorStatus[] {
      return [...byName.values()].map((c) => c.status());
    },
    get(name) {
      return byName.get(name) ?? null;
    },
    async syncOne(name) {
      const c = byName.get(name);
      if (!c) return { error: `unknown connector: ${name}` };
      try {
        return await c.sync(ctx);
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
    async syncAll() {
      const out: Record<string, ConnectorSyncResult | { error: string }> = {};
      for (const c of byName.values()) {
        try {
          out[c.name] = await c.sync(ctx);
        } catch (err) {
          out[c.name] = { error: (err as Error).message };
        }
      }
      return out;
    },
    async stopAll() {
      for (const c of byName.values()) {
        try {
          await c.stop();
        } catch {
          /* */
        }
      }
    },
  };
}
