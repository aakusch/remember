import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/cli/commands/init.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'remember-init-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(tmp, rel), 'utf8');
}

describe('remember init scaffold', () => {
  it('creates the expected files with the seeded trio', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);

    for (const f of [
      'remember.config.ts',
      'package.json',
      '.gitignore',
      '.rememberignore',
      '.env.example',
      'content/getting-started.md',
      'content/agents.md',
      'content/authoring.md',
    ]) {
      await expect(fs.access(path.join(dir, f))).resolves.toBeUndefined();
    }
  });

  it('scaffolds @useremember/core only — no viewer dependency', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@useremember/core']).toMatch(/^\^0\.2\./);
    // OSS is CLI + API only — the browser UI is a Pro feature. The scaffold
    // must not pull in the deprecated @useremember/viewer package.
    expect(pkg.dependencies['@useremember/viewer']).toBeUndefined();
    expect(pkg.scripts.dev).toBe('remember dev');
  });

  it('generates a CLI/API config with no viewer block', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);
    const cfg = await read('wiki/remember.config.ts');
    expect(cfg).not.toContain('viewer:');
    expect(cfg).not.toContain('landing');
    expect(cfg).not.toContain('port: 4321');
  });

  it('generates an admin token by default and writes it to the config', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);
    const cfg = await fs.readFile(path.join(dir, 'remember.config.ts'), 'utf8');
    expect(cfg).toContain("adminToken: process.env.REMEMBER_ADMIN_TOKEN ??");
  });

  it('omits the admin token with { noToken: true }', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir, { noToken: true });
    const cfg = await fs.readFile(path.join(dir, 'remember.config.ts'), 'utf8');
    expect(cfg).not.toContain("adminToken: process.env.REMEMBER_ADMIN_TOKEN ??");
  });

  it('refuses to scaffold into a non-empty directory', async () => {
    const dir = path.join(tmp, 'wiki');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'existing.txt'), 'hi');
    await expect(init(dir)).rejects.toThrow(/not empty/);
  });
});
