import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFlags, detectPackageManager } from '../src/cli/commands/setup-cmd.js';
import { init } from '../src/cli/commands/init.js';
import { AGENT_TRIGGER_SNIPPET } from '../src/cli/agent-snippet.js';

describe('setup — flag parsing', () => {
  it('parses flags and a positional folder', () => {
    expect(parseFlags(['my-wiki', '--yes', '--no-start'])).toMatchObject({
      folder: 'my-wiki',
      yes: true,
      noStart: true,
      noToken: false,
    });
    const short = parseFlags(['-y']);
    expect(short.yes).toBe(true);
    expect(short.folder).toBeUndefined();
  });

  it('rejects unknown flags', () => {
    expect(() => parseFlags(['--wat'])).toThrow(/unknown flag/);
  });
});

describe('setup — package-manager detection', () => {
  it('reads the npm user-agent', () => {
    expect(detectPackageManager('pnpm/8.15.0 npm/? node/v22')).toBe('pnpm');
    expect(detectPackageManager('yarn/1.22.19')).toBe('yarn');
    expect(detectPackageManager('bun/1.1.0')).toBe('bun');
    expect(detectPackageManager('npm/10.2.3 node/v22')).toBe('npm');
    expect(detectPackageManager('')).toBe('npm');
  });
});

describe('setup — init quiet mode + agent doc', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-setup-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('quiet init returns the token without printing the banner', async () => {
    const dir = path.join(tmp, 'wiki');
    const writes: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    // @ts-expect-error test shim
    process.stdout.write = (chunk: string) => (writes.push(String(chunk)), true);
    try {
      const result = await init(dir, { quiet: true });
      expect(result.adminToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    } finally {
      process.stdout.write = orig;
    }
    expect(writes.join('')).not.toMatch(/Next steps/);
  });

  it('seeds content/remember.md carrying the agent trigger snippet', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir, { quiet: true });
    const doc = await fs.readFile(path.join(dir, 'content', 'remember.md'), 'utf8');
    // The seeded agent doc carries the exact snippet a user/agent copies out.
    expect(doc).toContain('remember — recall from the knowledge base');
    expect(AGENT_TRIGGER_SNIPPET).toContain('retrieval request');
    // No stale agents.md.
    await expect(fs.access(path.join(dir, 'content', 'agents.md'))).rejects.toThrow();
  });
});
