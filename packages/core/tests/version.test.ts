import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';

// Regression guard: src/version.ts (what the CLI/API/OpenAPI report) MUST equal
// package.json "version" (what npm publishes). They drifted to 0.2.4 vs 0.2.5 vs a
// 0.2.6 npm release once — so `remember --version` lied about what was installed.
describe('version consistency', () => {
  it('src/version.ts VERSION equals package.json version', () => {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('VERSION is a valid semver-ish string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});
