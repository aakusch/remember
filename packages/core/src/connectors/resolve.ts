import path from 'node:path';
import type { Connector } from './types.js';
import { createObsidianConnector, type ObsidianConnectorOptions } from './obsidian.js';
import { createGranolaConnector, type GranolaConnectorOptions } from './granola.js';
import { createFilesystemConnector, type FilesystemConnectorOptions } from './filesystem.js';

interface ConnectorDescriptor {
  _kind: 'connector';
  type: 'obsidian' | 'granola' | 'filesystem';
  opts: Record<string, unknown>;
}

function isDescriptor(v: unknown): v is ConnectorDescriptor {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { _kind?: unknown })._kind === 'connector' &&
    typeof (v as { type?: unknown }).type === 'string'
  );
}

/**
 * Resolve descriptors emitted by `defaults.connector.*` into actual Connector
 * instances. Paths are normalized: relative paths become absolute against rootDir.
 */
export function resolveConnectors(rawConnectors: unknown, rootDir: string): Connector[] {
  if (!Array.isArray(rawConnectors)) return [];
  const out: Connector[] = [];
  for (const item of rawConnectors) {
    if (!isDescriptor(item)) {
      // Maybe it's already a Connector — accept it.
      if (typeof item === 'object' && item !== null && typeof (item as Connector).sync === 'function') {
        out.push(item as Connector);
      }
      continue;
    }
    const opts = { ...item.opts } as Record<string, unknown>;
    // Normalize any path-shaped fields
    for (const key of ['vaultPath', 'sourcePath']) {
      const v = opts[key];
      if (typeof v === 'string' && !path.isAbsolute(v)) {
        opts[key] = path.resolve(rootDir, v);
      }
    }
    switch (item.type) {
      case 'obsidian':
        out.push(createObsidianConnector(opts as unknown as ObsidianConnectorOptions));
        break;
      case 'granola':
        out.push(createGranolaConnector(opts as unknown as GranolaConnectorOptions));
        break;
      case 'filesystem':
        out.push(createFilesystemConnector(opts as unknown as FilesystemConnectorOptions));
        break;
    }
  }
  return out;
}
