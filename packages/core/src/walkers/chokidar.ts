import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { Walker } from '../types.js';

export interface ChokidarWalkerOptions {
  respectGitignore?: boolean;
  ignore?: string[];
}

const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  '.remember',
  'drafts/**',
  '_*/**',
  '*.tmp',
];

export function createChokidarWalker(opts: ChokidarWalkerOptions = {}): Walker {
  return {
    async *walk(root) {
      const absRoot = path.resolve(root);
      const ig = await loadIgnore(absRoot, opts);

      for await (const entry of walkDir(absRoot, absRoot, ig)) {
        yield entry;
      }
    },
  };
}

async function loadIgnore(absRoot: string, opts: ChokidarWalkerOptions): Promise<Ignore> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);

  if (opts.ignore && opts.ignore.length > 0) {
    ig.add(opts.ignore);
  }

  if (opts.respectGitignore !== false) {
    const gitignorePath = path.join(absRoot, '.gitignore');
    const rememberignorePath = path.join(absRoot, '.rememberignore');
    for (const p of [gitignorePath, rememberignorePath]) {
      try {
        const text = await fs.readFile(p, 'utf8');
        ig.add(text);
      } catch {
        // file absent — fine
      }
    }
  }

  return ig;
}

async function* walkDir(
  absRoot: string,
  dir: string,
  ig: Ignore,
): AsyncGenerator<{ path: string; content: string; mtime: Date; sha256: string }> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(absRoot, abs);
    const relPosix = rel.split(path.sep).join('/');

    if (!relPosix || ig.ignores(relPosix) || (entry.isDirectory() && ig.ignores(`${relPosix}/`))) {
      continue;
    }

    if (entry.isDirectory()) {
      yield* walkDir(absRoot, abs, ig);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = await fs.readFile(abs, 'utf8');
      const stat = await fs.stat(abs);
      yield {
        path: relPosix,
        content,
        mtime: stat.mtime,
        sha256: createHash('sha256').update(content).digest('hex'),
      };
    }
  }
}
