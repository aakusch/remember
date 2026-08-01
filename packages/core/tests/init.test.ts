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
      'content/remember.md',
      'content/authoring.md',
    ]) {
      await expect(fs.access(path.join(dir, f))).resolves.toBeUndefined();
    }
  });

  it('scaffolds @useremember/core only — no viewer dependency', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@useremember/core']).toMatch(/^\^0\.3\./);
    // OSS is CLI + API only — the browser UI is a Pro feature. The scaffold
    // must not pull in the deprecated @useremember/viewer package.
    expect(pkg.dependencies['@useremember/viewer']).toBeUndefined();
    expect(pkg.scripts.dev).toBe('remember dev');
  });

  it('scaffold opts into the local embedder (optional peer of the engine)', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    // The engine declares @huggingface/transformers as an OPTIONAL PEER so a bare
    // `npm install @useremember/core` stays lean/audit-clean; a real wiki opts in
    // here so first-run gets real BGE embeddings instead of the hash fallback.
    expect(pkg.dependencies['@huggingface/transformers']).toBeDefined();
    // pnpm >=10 needs sharp/onnxruntime (transformers' native deps) pre-approved.
    expect(pkg.pnpm.onlyBuiltDependencies).toContain('onnxruntime-node');
  });

  it('generates a CLI/API config with no viewer block', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);
    const cfg = await read('wiki/remember.config.ts');
    expect(cfg).not.toContain('viewer:');
    expect(cfg).not.toContain('landing');
    expect(cfg).not.toContain('port: 4321');
  });

  it('generates an admin token into .env — never inlined into the committable config', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);
    const cfg = await fs.readFile(path.join(dir, 'remember.config.ts'), 'utf8');
    // Config reads the token from the environment and never carries the literal.
    expect(cfg).toContain('adminToken: process.env.REMEMBER_ADMIN_TOKEN ?? null');

    const env = await read('wiki/.env');
    const m = env.match(/REMEMBER_ADMIN_TOKEN=([A-Za-z0-9_-]{20,})/);
    expect(m).not.toBeNull();
    const token = m![1];

    // The secret must not appear in ANY file that isn't gitignored.
    expect(cfg).not.toContain(token);
    const gitignore = await read('wiki/.gitignore');
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });

  it('the scaffold package.json pre-approves native builds for pnpm >=10', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir);
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.pnpm.onlyBuiltDependencies).toContain('better-sqlite3');
  });

  it('omits the admin token (and .env) with { noToken: true }', async () => {
    const dir = path.join(tmp, 'wiki');
    await init(dir, { noToken: true });
    const cfg = await fs.readFile(path.join(dir, 'remember.config.ts'), 'utf8');
    expect(cfg).not.toContain('adminToken: process.env.REMEMBER_ADMIN_TOKEN ?? null');
    await expect(fs.access(path.join(dir, '.env'))).rejects.toThrow();
  });

  it('refuses to scaffold into a directory with real files', async () => {
    const dir = path.join(tmp, 'wiki');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'existing.txt'), 'hi');
    await expect(init(dir)).rejects.toThrow(/empty directory/);
  });

  it('scaffolds into a directory that holds only benign entries (.git, .DS_Store)', async () => {
    const dir = path.join(tmp, 'wiki');
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    await fs.writeFile(path.join(dir, '.DS_Store'), '');
    await init(dir);
    await expect(fs.access(path.join(dir, 'remember.config.ts'))).resolves.toBeUndefined();
  });
});
