import { describe, it, expect, vi } from 'vitest';
import {
  buildCapabilities,
  CAPABILITY_COMMANDS,
  JSON_SCHEMA_VERSION,
} from '../src/capabilities.js';
import { VERSION } from '../src/version.js';
import { COMMANDS } from '../src/cli/index.js';
import { capabilitiesCommand } from '../src/cli/commands/capabilities-cmd.js';

describe('buildCapabilities', () => {
  it('emits a stable top-level key set and order', () => {
    // Agents wire against this shape — lock the keys and their order.
    expect(Object.keys(buildCapabilities())).toEqual([
      'version',
      'engine',
      'embedder',
      'endpoints',
      'commands',
      'json_schema_version',
    ]);
  });

  it('reports the engine version and schema version', () => {
    const caps = buildCapabilities();
    expect(caps.version).toBe(VERSION);
    expect(caps.json_schema_version).toBe(JSON_SCHEMA_VERSION);
    expect(caps.engine.edition).toBe('open-source');
    expect(caps.engine.license).toBe('MIT');
    expect(caps.engine.api_base).toBe('/v1');
    expect(caps.engine.default_port).toBe(4320);
  });

  it('defaults embedder to null and passes one through when given', () => {
    expect(buildCapabilities().embedder).toBeNull();
    expect(
      buildCapabilities({ embedder: { model: 'BAAI/bge-small-en-v1.5', dim: 384 } }).embedder,
    ).toEqual({ model: 'BAAI/bge-small-en-v1.5', dim: 384 });
  });

  it('lists /v1/capabilities among its own endpoints', () => {
    const paths = buildCapabilities().endpoints.map((e) => e.path);
    expect(paths).toContain('/v1/capabilities');
    expect(paths).toContain('/v1/search');
    expect(paths).toContain('/v1/tools');
  });

  it('returns fresh copies so callers cannot mutate the catalogs', () => {
    const a = buildCapabilities();
    a.endpoints.push({ method: 'GET', path: '/hacked', summary: 'x' });
    a.commands.length = 0;
    const b = buildCapabilities();
    expect(b.endpoints.some((e) => e.path === '/hacked')).toBe(false);
    expect(b.commands.length).toBeGreaterThan(0);
  });

  it('every capability command is a real CLI command (no drift)', () => {
    const cliNames = new Set(COMMANDS.map((c) => c.name));
    for (const cmd of CAPABILITY_COMMANDS) {
      expect(cliNames.has(cmd.name)).toBe(true);
    }
  });
});

describe('remember capabilities --json', () => {
  it('prints valid JSON matching the discovery shape', async () => {
    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array) => {
        chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString());
        return true;
      });
    try {
      await capabilitiesCommand(['--json']);
    } finally {
      spy.mockRestore();
    }
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.version).toBe(VERSION);
    expect(parsed.json_schema_version).toBe(JSON_SCHEMA_VERSION);
    expect(Array.isArray(parsed.endpoints)).toBe(true);
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect(parsed.commands.map((c: { name: string }) => c.name)).toContain('capabilities');
  });
});
